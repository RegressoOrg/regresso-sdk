import {
  type BeaconV1,
  encodeBeacon,
  type MetricsV1,
  type NavigationType,
  PROTOCOL_VERSION,
} from "@regresso/protocol";
import {
  type MetricWithAttribution,
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
} from "web-vitals/attribution";
import {
  clsEntry,
  fcpEntry,
  inpEntry,
  lcpEntry,
  nearestComponent,
  ttfbEntry,
} from "./attribution.js";

export { ATTR, nearestComponent } from "./attribution.js";

/** Default beacon endpoint when neither `endpoint` nor `REGRESSO_INGEST_URL` is set. */
export const DEFAULT_ENDPOINT = "https://ingest.regresso.dev";

/** `granted`: send beacons. `pending`: measure, but hold beacons until {@link setConsent}(true). */
export type Consent = "granted" | "pending";

export interface RegressoOptions {
  /**
   * Project public key, `pk_…`. Default: the key the framework adapter injected at build time from
   * the framework's public env variable (Next.js: `NEXT_PUBLIC_REGRESSO_KEY`).
   */
  publicKey?: string;
  /**
   * URL beacons are POSTed to. Default: `REGRESSO_INGEST_URL` at build time, else
   * {@link DEFAULT_ENDPOINT}.
   */
  endpoint?: string;
  /**
   * Share of page views to measure, 0 < sampleRate ≤ 1. Default 1. Decided once per page load;
   * unsampled pages register no observers at all.
   */
  sampleRate?: number;
  /**
   * Starting consent state. Default `granted`. With `pending`, metrics are measured but nothing is
   * sent until {@link setConsent}(true); a call to `setConsent` before `initRegresso` wins.
   */
  consent?: Consent;
  /** Log configuration problems, sampling decisions and every beacon to the console. Default false. */
  debug?: boolean;
  /** Build id of the running bundle. Default: the one the build plugin injected. */
  buildId?: string;
}

interface Injected {
  buildId?: string;
  publicKey?: string;
  endpoint?: string;
}

declare const __REGRESSO_BUILD__: Injected | undefined;

interface PageView {
  /** web-vitals navigationId: a new one starts on bfcache restore. */
  nav: number;
  b: BeaconV1;
  dirty: boolean;
}

let started = false;
let consent: Consent | undefined;
/** Set by initRegresso: sends whatever was held while consent was pending. */
let flush: (() => void) | undefined;

function pageViewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const x of bytes) s += (x + 256).toString(16).slice(1);
  return s;
}

/**
 * Grants or withdraws consent. Granting sends anything held while consent was pending (if the page
 * was already hidden) and lets later beacons go out; withdrawing holds them again. Safe to call
 * before {@link initRegresso} and during SSR.
 */
export function setConsent(granted: boolean): void {
  consent = granted ? "granted" : "pending";
  if (granted) flush?.();
}

/**
 * Starts measuring Core Web Vitals for this page load and sends one beacon per page view when the
 * page is hidden. Safe to call more than once (later calls are ignored) and during SSR (does nothing).
 */
export function initRegresso(options: RegressoOptions = {}): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const injected: Injected = typeof __REGRESSO_BUILD__ === "object" ? __REGRESSO_BUILD__ : {};
  const debug = options.debug === true;
  const log = (...args: unknown[]) => debug && console.info("[regresso]", ...args);
  const pk = options.publicKey ?? injected.publicKey;
  const bid = options.buildId ?? injected.buildId;
  const endpoint = options.endpoint ?? injected.endpoint ?? DEFAULT_ENDPOINT;
  const sr = options.sampleRate ?? 1;

  // Without a key or build id the ingest would reject every beacon, so say so even without debug.
  // Kept short: these strings ship in every bundle. The READMEs' troubleshooting sections explain.
  const problem = !pk ? "publicKey" : !bid ? "buildId" : sr > 0 && sr <= 1 ? "" : "sampleRate";
  if (problem) {
    console.warn(`[regresso] not started: missing or invalid ${problem}`);
    return;
  }

  consent ??= options.consent ?? "granted";
  if (Math.random() >= sr) {
    log("not sampled", sr);
    return;
  }
  log("started", { pk, bid, endpoint, sr, consent });

  let view: PageView | undefined;
  /** A hide happened while consent was pending, so a beacon is waiting. */
  let held = false;

  const send = (): void => {
    if (!view?.dirty) return;
    if (consent !== "granted") {
      held = true;
      log("consent pending, held");
      return;
    }
    held = false;
    const body = encodeBeacon(view.b);
    if (debug) log("beacon", JSON.parse(body));
    view.dirty = false;
    view.b.q = (view.b.q ?? 0) + 1;
    try {
      if (navigator.sendBeacon?.(endpoint, body)) return;
    } catch {}
    // A string body is sent as text/plain, so neither path triggers a CORS preflight.
    fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      mode: "no-cors",
      credentials: "omit",
    }).catch(() => {});
  };
  flush = () => held && send();

  const record = (m: MetricWithAttribution, key: keyof MetricsV1, entry: unknown): void => {
    if (!view || view.nav !== m.navigationId) {
      send(); // a new page view (bfcache restore) begins; flush the previous one
      view = {
        nav: m.navigationId,
        dirty: false,
        b: {
          v: PROTOCOL_VERSION,
          pk: pk as string,
          bid: bid as string,
          p: location.pathname,
          nav: m.navigationType as NavigationType,
          sid: pageViewId(),
          sr,
          q: 0,
          m: {},
        },
      };
    }
    (view.b.m as Record<string, unknown>)[key] = entry;
    view.dirty = true;
  };

  const opts = { generateTarget: nearestComponent };
  onTTFB((m) => record(m, "ttfb", ttfbEntry(m)), opts);
  onFCP((m) => record(m, "fcp", fcpEntry(m)), opts);
  onLCP((m) => record(m, "lcp", lcpEntry(m)), opts);
  onINP((m) => record(m, "inp", inpEntry(m)), opts);
  onCLS((m) => record(m, "cls", clsEntry(m)), opts);

  // web-vitals reports CLS, INP and LCP from `visibilitychange` listeners on `window` in the capture
  // phase, some of which it adds lazily. The event targets `document`, so a listener on `document`
  // runs after all of them, however late they were added. There is deliberately no `pagehide`
  // listener: Chromium fires it before `visibilitychange` when unloading, which would send a beacon
  // without the final CLS, INP and LCP (web-vitals recommends `visibilitychange` alone).
  document.addEventListener(
    "visibilitychange",
    () => document.visibilityState === "hidden" && send(),
  );
}
