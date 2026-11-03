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

export interface RegressoOptions {
  /** Project public key, `pk_…`. */
  pk: string;
  /** URL beacons are POSTed to. */
  endpoint: string;
  /** Build id of the running bundle. `@regresso/next/client` fills this in for you. */
  buildId: string;
  /**
   * Share of page views to measure, 0 < sampleRate ≤ 1. Default 1. The decision is made once per
   * page load; unsampled pages register no observers at all.
   */
  sampleRate?: number;
  /**
   * Consent hook, called synchronously each time a beacon is about to be sent (the page is being
   * hidden, so it cannot wait for a promise). Return false to hold the beacon; it is sent at the next
   * opportunity once this returns true, and dropped if the page is closed first. Default: always true.
   */
  consent?: () => boolean;
}

interface PageView {
  /** web-vitals navigationId: a new one starts on bfcache restore. */
  nav: number;
  b: BeaconV1;
  dirty: boolean;
}

let started = false;

function pageViewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const x of bytes) s += (x + 256).toString(16).slice(1);
  return s;
}

/**
 * Starts measuring Core Web Vitals for this page load and sends one beacon per page view
 * when the page is hidden. Safe to call more than once; later calls are ignored.
 */
export function init(options: RegressoOptions): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const sr = options.sampleRate ?? 1;
  if (!(sr > 0 && sr <= 1) || Math.random() >= sr) return;

  const consent = options.consent ?? (() => true);
  let view: PageView | undefined;

  const send = (): void => {
    if (!view?.dirty) return;
    try {
      if (!consent()) return;
    } catch {
      return;
    }
    const body = encodeBeacon(view.b);
    view.dirty = false;
    view.b.q = (view.b.q ?? 0) + 1;
    try {
      if (navigator.sendBeacon?.(options.endpoint, body)) return;
    } catch {}
    // A string body is sent as text/plain, so neither path triggers a CORS preflight.
    fetch(options.endpoint, {
      method: "POST",
      body,
      keepalive: true,
      mode: "no-cors",
      credentials: "omit",
    }).catch(() => {});
  };

  const record = (m: MetricWithAttribution, key: keyof MetricsV1, entry: unknown): void => {
    if (!view || view.nav !== m.navigationId) {
      send(); // a new page view (bfcache restore) begins; flush the previous one
      view = {
        nav: m.navigationId,
        dirty: false,
        b: {
          v: PROTOCOL_VERSION,
          pk: options.pk,
          bid: options.buildId,
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
