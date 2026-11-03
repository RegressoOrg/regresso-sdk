import {
  type ClsEntryV1,
  COMPONENT_ID_RE,
  type ComponentId,
  type FcpEntryV1,
  type InpEntryV1,
  type InpScriptV1,
  type LcpEntryV1,
  MAX_CLS,
  MAX_MS,
  MAX_SHIFT_SOURCES,
  TAG_NAME_RE,
  type TtfbEntryV1,
} from "@regresso/protocol";
import type {
  CLSMetricWithAttribution,
  FCPMetricWithAttribution,
  INPMetricWithAttribution,
  LCPMetricWithAttribution,
  TTFBMetricWithAttribution,
} from "web-vitals/attribution";

/** The attribute the build plugin adds to each component's outermost element. */
export const ATTR = "data-cwv";

/**
 * Walks from a node up to the nearest element tagged by the build plugin and returns its
 * component id, or "" when there is none. Passed to web-vitals as `generateTarget`, which
 * calls it while the element is still in the DOM. Returning "" (not undefined) stops
 * web-vitals from falling back to a CSS selector, which could carry ids or class names.
 */
export function nearestComponent(node: Node | null | undefined): ComponentId {
  if (!node) return "";
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const id = el?.closest(`[${ATTR}]`)?.getAttribute(ATTR);
  return id && COMPONENT_ID_RE.test(id) ? id : "";
}

/** Keeps a web-vitals target only if it is a component id, never a selector. */
const cid = (target: string | undefined): ComponentId | undefined =>
  target && COMPONENT_ID_RE.test(target) ? target : undefined;

const ms = (x: number | undefined): number => {
  const n = Math.round(x ?? 0);
  return n > 0 ? Math.min(n, MAX_MS) : 0; // also maps NaN to 0
};

const score = (x: number | undefined): number => {
  const n = Math.round((x ?? 0) * 1e4) / 1e4;
  return n > 0 ? Math.min(n, MAX_CLS) : 0;
};

/** Origin + path of a script URL; undefined for non-http(s) URLs (extensions, blobs, inline). */
export function scriptUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const s = u.origin + u.pathname;
    return /^https?:$/.test(u.protocol) && s.length <= 512 ? s : undefined;
  } catch {
    return undefined;
  }
}

type Loose<T> = { [K in keyof T]-?: T[K] | undefined };

/** Deletes undefined values, so optional fields are absent from the JSON rather than undefined. */
function defined<T extends object>(o: Loose<T>): T {
  for (const k in o) if (o[k] === undefined) delete o[k];
  return o as T;
}

export function lcpEntry(m: LCPMetricWithAttribution): LcpEntryV1 {
  const a = m.attribution;
  const tag = a.lcpEntry?.element?.tagName.toLowerCase();
  return defined<LcpEntryV1>({
    v: ms(m.value),
    c: cid(a.target),
    el: tag && TAG_NAME_RE.test(tag) ? tag : undefined,
    ttfb: ms(a.timeToFirstByte),
    loadDelay: ms(a.resourceLoadDelay),
    loadDuration: ms(a.resourceLoadDuration),
    renderDelay: ms(a.elementRenderDelay),
  });
}

export function inpEntry(m: INPMetricWithAttribution): InpEntryV1 {
  const a = m.attribution;
  const ls = a.longestScript;
  const url = scriptUrl(ls?.entry.sourceURL);
  const script: InpScriptV1 | undefined =
    ls && url ? { url, dur: ms(ls.intersectingDuration), part: ls.subpart } : undefined;
  return defined<InpEntryV1>({
    v: ms(m.value),
    c: cid(a.interactionTarget),
    type: a.interactionType,
    inputDelay: ms(a.inputDelay),
    processing: ms(a.processingDuration),
    presentation: ms(a.presentationDelay),
    load: a.loadState,
    script,
  });
}

export function clsEntry(m: CLSMetricWithAttribution): ClsEntryV1 {
  const a = m.attribution;
  const src: ComponentId[] = [];
  for (const s of a.largestShiftEntry?.sources ?? []) {
    const id = nearestComponent(s.node);
    if (id && !src.includes(id) && src.length < MAX_SHIFT_SOURCES) src.push(id);
  }
  return defined<ClsEntryV1>({
    v: score(m.value),
    c: cid(a.largestShiftTarget),
    src: src.length ? src : undefined,
    largest: a.largestShiftValue === undefined ? undefined : score(a.largestShiftValue),
  });
}

export function fcpEntry(m: FCPMetricWithAttribution): FcpEntryV1 {
  return { v: ms(m.value), ttfb: ms(m.attribution.timeToFirstByte) };
}

export function ttfbEntry(m: TTFBMetricWithAttribution): TtfbEntryV1 {
  const a = m.attribution;
  return {
    v: ms(m.value),
    wait: ms(a.waitingDuration),
    cache: ms(a.cacheDuration),
    dns: ms(a.dnsDuration),
    conn: ms(a.connectionDuration),
    req: ms(a.requestDuration),
  };
}
