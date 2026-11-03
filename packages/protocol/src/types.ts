/**
 * Beacon protocol v1: one beacon per page view, sent by `@regresso/browser`
 * and validated by the ingest Worker.
 *
 * Top-level keys are short because they are on every beacon. See the package
 * README for field documentation and the compatibility rules.
 */

/** How the page view started. Mirrors web-vitals' `navigationType`. */
export type NavigationType =
  | "navigate"
  | "reload"
  | "back-forward"
  | "back-forward-cache"
  | "prerender"
  | "restore"
  | "soft-navigation";

/** Document load state when an INP interaction happened. Mirrors web-vitals' `LoadState`. */
export type LoadState = "loading" | "dom-interactive" | "dom-content-loaded" | "complete";

/** Which part of an interaction the longest script ran in. */
export type InteractionSubpart = "input-delay" | "processing-duration" | "presentation-delay";

/**
 * `data-cwv` value of a component: a short base36 hash of
 * (repo-relative file path, component name). Opaque to the client.
 */
export type ComponentId = string;

/** Largest Contentful Paint, in milliseconds. */
export interface LcpEntryV1 {
  /** LCP value, ms. */
  v: number;
  /** Component owning the LCP element (nearest `data-cwv` ancestor). */
  c?: ComponentId;
  /** Lower-case tag name of the LCP element, e.g. `img`. Never its text or attributes. */
  el?: string;
  /** LCP breakdown, ms: time to first byte. */
  ttfb: number;
  /** LCP breakdown, ms: TTFB → resource request start. */
  loadDelay: number;
  /** LCP breakdown, ms: resource request start → resource loaded. */
  loadDuration: number;
  /** LCP breakdown, ms: resource loaded → element rendered. */
  renderDelay: number;
}

/** Longest script that ran during the INP interaction. */
export interface InpScriptV1 {
  /** Script URL: `http(s)` origin + path only; query and fragment are stripped by the client. */
  url: string;
  /** Duration of the script that overlapped the interaction, ms. */
  dur: number;
  /** Which interaction subpart it ran in. */
  part: InteractionSubpart;
}

/** Interaction to Next Paint, in milliseconds. */
export interface InpEntryV1 {
  /** INP value, ms. */
  v: number;
  /** Component owning the interaction target. */
  c?: ComponentId;
  /** Interaction type. */
  type?: "pointer" | "keyboard";
  /** INP breakdown, ms. */
  inputDelay: number;
  processing: number;
  presentation: number;
  /** Document load state when the interaction happened. */
  load?: LoadState;
  /** Longest script that ran during the interaction (Long Animation Frames API; Chromium only). */
  script?: InpScriptV1;
}

/** Cumulative Layout Shift (unitless score). */
export interface ClsEntryV1 {
  /** CLS score. */
  v: number;
  /** Component owning the first element that moved in the largest shift. */
  c?: ComponentId;
  /** Components of every element that moved in the largest shift, deduplicated, at most 5. */
  src?: ComponentId[];
  /** Score of the largest single shift. */
  largest?: number;
}

/** First Contentful Paint, in milliseconds. */
export interface FcpEntryV1 {
  v: number;
  /** FCP breakdown, ms: time to first byte. */
  ttfb: number;
}

/** Time to First Byte, in milliseconds. */
export interface TtfbEntryV1 {
  v: number;
  /** TTFB breakdown, ms. */
  wait: number;
  cache: number;
  dns: number;
  conn: number;
  req: number;
}

export interface MetricsV1 {
  lcp?: LcpEntryV1;
  inp?: InpEntryV1;
  cls?: ClsEntryV1;
  fcp?: FcpEntryV1;
  ttfb?: TtfbEntryV1;
}

export interface BeaconV1 {
  /** Protocol version. */
  v: 1;
  /** Project public key, `pk_…`. Safe to expose in the page. */
  pk: string;
  /** Build id injected at build time. */
  bid: string;
  /** Pathname only: no origin, query or fragment. The edge maps it to a route template and drops it. */
  p: string;
  /** Navigation type. */
  nav: NavigationType;
  /** Random id for this page view. Not a user or session id: a new one is made on every page view. */
  sid: string;
  /** Sample rate in effect, 0 < sr ≤ 1. Each beacon stands for 1/sr page views. */
  sr: number;
  /**
   * Sequence number of this beacon within the page view, starting at 0. A page view that is hidden
   * and shown again re-sends a fuller snapshot with q+1. Consumers keep the highest q per sid.
   */
  q?: number;
  /** Metrics measured so far. May be empty: the beacon still counts as a page view. */
  m: MetricsV1;
}

/** Every beacon version this package can decode. Discriminated by `v`. */
export type Beacon = BeaconV1;
