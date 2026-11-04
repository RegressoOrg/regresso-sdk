import {
  BUILD_ID_RE,
  COMPONENT_ID_RE,
  INTERACTION_SUBPARTS,
  INTERACTION_TYPES,
  LOAD_STATES,
  MAX_CLS,
  MAX_MS,
  MAX_SHIFT_SOURCES,
  NAVIGATION_TYPES,
  PAGE_VIEW_ID_RE,
  PATHNAME_RE,
  PUBLIC_KEY_RE,
  SCRIPT_URL_RE,
  SUPPORTED_VERSIONS,
  TAG_NAME_RE,
} from "./constants.js";
import type { Beacon, BeaconV1, MetricsV1 } from "./types.js";

/** One problem found by the validator. `path` is dotted, e.g. `m.lcp.v`. */
export interface Issue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** Stop collecting after this many issues; a beacon this broken is rejected either way. */
const MAX_ISSUES = 20;

/** @internal */
export type Obj = Record<string, unknown>;

/** @internal */
export const isObj = (x: unknown): x is Obj =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Collects issues while copying known fields into a fresh object. Unknown fields are
 * dropped, which is what lets an older reader accept a newer v1 beacon (see README).
 */
/** @internal Shared with the build upload validator; not part of the public API. */
export class Reader {
  issues: Issue[] = [];

  fail(path: string, message: string): undefined {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, message });
    return undefined;
  }

  num(src: Obj, key: string, path: string, max: number, required: boolean): number | undefined {
    const x = src[key];
    if (x === undefined) return required ? this.fail(path + key, "required") : undefined;
    if (typeof x !== "number" || !Number.isFinite(x)) return this.fail(path + key, "not a number");
    if (x < 0 || x > max) return this.fail(path + key, `out of range [0, ${max}]`);
    return x;
  }

  str(src: Obj, key: string, path: string, re: RegExp, required: boolean): string | undefined {
    const x = src[key];
    if (x === undefined) return required ? this.fail(path + key, "required") : undefined;
    if (typeof x !== "string" || !re.test(x)) return this.fail(path + key, "invalid format");
    return x;
  }

  oneOf<T extends string>(
    src: Obj,
    key: string,
    path: string,
    allowed: readonly string[],
    required: boolean,
  ): T | undefined {
    const x = src[key];
    if (x === undefined) return required ? this.fail(path + key, "required") : undefined;
    if (typeof x !== "string" || !allowed.includes(x)) {
      return this.fail(path + key, `expected one of ${allowed.join(", ")}`);
    }
    return x as T;
  }

  obj(src: Obj, key: string, path: string): Obj | undefined {
    const x = src[key];
    if (x === undefined) return undefined;
    if (!isObj(x)) return this.fail(path + key, "not an object");
    return x;
  }
}

/** Copies `[key, value]` pairs whose value is defined, so optional fields stay absent, not `undefined`. */
/** @internal */
export function pick<T>(entries: [string, unknown][]): T {
  const out: Obj = {};
  for (const [k, v] of entries) if (v !== undefined) out[k] = v;
  return out as T;
}

function readMetrics(r: Reader, m: Obj): MetricsV1 {
  const out: MetricsV1 = {};
  const cid = COMPONENT_ID_RE;

  const lcp = r.obj(m, "lcp", "m.");
  if (lcp) {
    const p = "m.lcp.";
    out.lcp = pick([
      ["v", r.num(lcp, "v", p, MAX_MS, true)],
      ["c", r.str(lcp, "c", p, cid, false)],
      ["el", r.str(lcp, "el", p, TAG_NAME_RE, false)],
      ["ttfb", r.num(lcp, "ttfb", p, MAX_MS, true)],
      ["loadDelay", r.num(lcp, "loadDelay", p, MAX_MS, true)],
      ["loadDuration", r.num(lcp, "loadDuration", p, MAX_MS, true)],
      ["renderDelay", r.num(lcp, "renderDelay", p, MAX_MS, true)],
    ]);
  }

  const inp = r.obj(m, "inp", "m.");
  if (inp) {
    const p = "m.inp.";
    let script: unknown;
    const s = r.obj(inp, "script", p);
    if (s) {
      const sp = "m.inp.script.";
      script = pick([
        ["url", r.str(s, "url", sp, SCRIPT_URL_RE, true)],
        ["dur", r.num(s, "dur", sp, MAX_MS, true)],
        ["part", r.oneOf(s, "part", sp, INTERACTION_SUBPARTS, true)],
      ]);
    }
    out.inp = pick([
      ["v", r.num(inp, "v", p, MAX_MS, true)],
      ["c", r.str(inp, "c", p, cid, false)],
      ["type", r.oneOf(inp, "type", p, INTERACTION_TYPES, false)],
      ["inputDelay", r.num(inp, "inputDelay", p, MAX_MS, true)],
      ["processing", r.num(inp, "processing", p, MAX_MS, true)],
      ["presentation", r.num(inp, "presentation", p, MAX_MS, true)],
      ["load", r.oneOf(inp, "load", p, LOAD_STATES, false)],
      ["script", script],
    ]);
  }

  const cls = r.obj(m, "cls", "m.");
  if (cls) {
    const p = "m.cls.";
    let src: string[] | undefined;
    const raw = cls.src;
    if (raw !== undefined) {
      if (!Array.isArray(raw) || raw.length > MAX_SHIFT_SOURCES) {
        r.fail(`${p}src`, `expected an array of at most ${MAX_SHIFT_SOURCES} component ids`);
      } else if (!raw.every((x) => typeof x === "string" && cid.test(x))) {
        r.fail(`${p}src`, "invalid component id");
      } else {
        src = raw.slice();
      }
    }
    out.cls = pick([
      ["v", r.num(cls, "v", p, MAX_CLS, true)],
      ["c", r.str(cls, "c", p, cid, false)],
      ["src", src],
      ["largest", r.num(cls, "largest", p, MAX_CLS, false)],
    ]);
  }

  const fcp = r.obj(m, "fcp", "m.");
  if (fcp) {
    const p = "m.fcp.";
    out.fcp = pick([
      ["v", r.num(fcp, "v", p, MAX_MS, true)],
      ["ttfb", r.num(fcp, "ttfb", p, MAX_MS, true)],
    ]);
  }

  const ttfb = r.obj(m, "ttfb", "m.");
  if (ttfb) {
    const p = "m.ttfb.";
    out.ttfb = pick([
      ["v", r.num(ttfb, "v", p, MAX_MS, true)],
      ["wait", r.num(ttfb, "wait", p, MAX_MS, true)],
      ["cache", r.num(ttfb, "cache", p, MAX_MS, true)],
      ["dns", r.num(ttfb, "dns", p, MAX_MS, true)],
      ["conn", r.num(ttfb, "conn", p, MAX_MS, true)],
      ["req", r.num(ttfb, "req", p, MAX_MS, true)],
    ]);
  }

  return out;
}

function readV1(r: Reader, b: Obj): BeaconV1 {
  const sr = b.sr;
  if (sr === undefined) r.fail("sr", "required");
  else if (typeof sr !== "number" || !Number.isFinite(sr) || sr <= 0 || sr > 1) {
    r.fail("sr", "out of range (0, 1]");
  }

  const q = b.q;
  if (q !== undefined && (!Number.isInteger(q) || (q as number) < 0 || (q as number) > 1000)) {
    r.fail("q", "expected an integer in [0, 1000]");
  }

  let metrics: MetricsV1 = {};
  if (b.m === undefined) r.fail("m", "required");
  else if (!isObj(b.m)) r.fail("m", "not an object");
  else metrics = readMetrics(r, b.m);

  return pick<BeaconV1>([
    ["v", 1],
    ["pk", r.str(b, "pk", "", PUBLIC_KEY_RE, true)],
    ["bid", r.str(b, "bid", "", BUILD_ID_RE, true)],
    ["p", r.str(b, "p", "", PATHNAME_RE, true)],
    ["nav", r.oneOf(b, "nav", "", NAVIGATION_TYPES, true)],
    ["sid", r.str(b, "sid", "", PAGE_VIEW_ID_RE, true)],
    ["sr", sr],
    ["q", q],
    ["m", metrics],
  ]);
}

/**
 * Validates an already-parsed value as a beacon of any supported version.
 *
 * On success, `value` is a fresh object holding only known fields: unknown fields are
 * dropped (forward compatibility within a version), so it is safe to store as-is.
 * Pure and dependency-free; runs in browsers, Workers and Node.
 */
export function validateBeacon(input: unknown): ValidationResult<Beacon> {
  if (!isObj(input)) return { ok: false, issues: [{ path: "", message: "not an object" }] };
  const v = input.v;
  if (typeof v !== "number" || !SUPPORTED_VERSIONS.includes(v)) {
    return { ok: false, issues: [{ path: "v", message: "unsupported version" }] };
  }
  const r = new Reader();
  const value = readV1(r, input);
  return r.issues.length ? { ok: false, issues: r.issues } : { ok: true, value };
}

/** Type guard form of {@link validateBeacon}. Does not strip unknown fields. */
export function isBeacon(input: unknown): input is Beacon {
  return validateBeacon(input).ok;
}
