import { describe, expect, it } from "vitest";
import {
  type BeaconV1,
  decodeBeacon,
  encodeBeacon,
  isBeacon,
  MAX_BEACON_BYTES,
  validateBeacon,
} from "../src/index.js";

const full: BeaconV1 = {
  v: 1,
  pk: "pk_test1234abcd",
  bid: "a1b2c3d-k9x2",
  p: "/products/blue-shoe",
  nav: "navigate",
  sid: "Qx7_b2-9aZ01",
  sr: 0.25,
  q: 0,
  m: {
    lcp: {
      v: 2140,
      c: "k3j9x0ab",
      el: "img",
      ttfb: 320,
      loadDelay: 110,
      loadDuration: 900,
      renderDelay: 810,
    },
    inp: {
      v: 344,
      c: "z9y8x7w6",
      type: "pointer",
      inputDelay: 12,
      processing: 290,
      presentation: 42,
      load: "complete",
      script: {
        url: "https://example.com/_next/static/chunks/app.js",
        dur: 270,
        part: "processing-duration",
      },
    },
    cls: { v: 0.12, c: "a0b1c2d3", src: ["a0b1c2d3", "e4f5g6h7"], largest: 0.09 },
    fcp: { v: 900, ttfb: 320 },
    ttfb: { v: 320, wait: 5, cache: 0, dns: 20, conn: 40, req: 255 },
  },
};

const minimal: BeaconV1 = {
  v: 1,
  pk: "pk_test1234abcd",
  bid: "b1",
  p: "/",
  nav: "reload",
  sid: "abcdefgh",
  sr: 1,
  m: {},
};

function clone<T>(x: T): T {
  return structuredClone(x);
}

function issuesOf(input: unknown) {
  const r = validateBeacon(input);
  return r.ok ? [] : r.issues;
}

describe("validateBeacon", () => {
  it("accepts a full beacon unchanged", () => {
    const r = validateBeacon(clone(full));
    expect(r).toEqual({ ok: true, value: full });
  });

  it("accepts a minimal beacon with no metrics", () => {
    expect(validateBeacon(clone(minimal))).toEqual({ ok: true, value: minimal });
  });

  it("returns a fresh object, not the input", () => {
    const input = clone(full);
    const r = validateBeacon(input);
    expect(r.ok && r.value).not.toBe(input);
    expect(r.ok && r.value.m.cls?.src).not.toBe(input.m.cls?.src);
  });

  it("drops unknown fields at every level (forward compatibility within v1)", () => {
    const input = {
      ...clone(minimal),
      future: 1,
      m: { fcp: { v: 1, ttfb: 1, extra: "x" }, fid: { v: 3 } },
    };
    const r = validateBeacon(input);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toEqual({ ...minimal, m: { fcp: { v: 1, ttfb: 1 } } });
  });

  it("keeps optional fields absent rather than undefined", () => {
    const r = validateBeacon(clone(minimal));
    expect(r.ok && Object.keys(r.value)).not.toContain("q");
  });

  it.each([null, 1, "x", [], undefined])("rejects non-object %p", (x) => {
    expect(issuesOf(x)).toEqual([{ path: "", message: "not an object" }]);
  });

  it.each([0, 2, "1", undefined, 1.5])("rejects version %p", (v) => {
    expect(issuesOf({ ...minimal, v })).toEqual([{ path: "v", message: "unsupported version" }]);
  });

  it.each(["pk", "bid", "p", "nav", "sid", "sr", "m"])("requires %s", (key) => {
    const b: Record<string, unknown> = { ...clone(minimal) };
    delete b[key];
    expect(issuesOf(b)).toEqual([{ path: key, message: "required" }]);
  });

  it.each([
    ["pk", "sk_secret1234"],
    ["pk", "pk_short"],
    ["bid", ""],
    ["bid", "has space"],
    ["p", "products"],
    ["p", "/a?b=c"],
    ["p", "/a#b"],
    ["p", "/a b"],
    ["p", `/${"a".repeat(1024)}`],
    ["p", "/a\nb"],
    ["nav", "push"],
    ["sid", "short"],
    ["sid", "has.dot.xxxx"],
    ["sr", 0],
    ["sr", 1.01],
    ["sr", -0.5],
    ["sr", Number.NaN],
    ["sr", "1"],
    ["q", -1],
    ["q", 1.5],
    ["q", 1001],
    ["m", []],
    ["m", "x"],
  ])("rejects %s = %p", (key, value) => {
    const issues = issuesOf({ ...minimal, [key]: value });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(key);
  });

  it("accepts boundary values", () => {
    const b = { ...clone(minimal), p: `/${"a".repeat(1023)}`, sr: 1e-6, q: 1000 };
    expect(validateBeacon(b).ok).toBe(true);
  });

  it.each([
    ["lcp", "v", -1],
    ["lcp", "v", 3_600_001],
    ["lcp", "v", Number.POSITIVE_INFINITY],
    ["lcp", "v", "100"],
    ["lcp", "c", "UPPERCASE"],
    ["lcp", "c", "abc"],
    ["lcp", "el", "IMG"],
    ["lcp", "el", "<img>"],
    ["lcp", "renderDelay", undefined],
    ["inp", "type", "touch"],
    ["inp", "load", "idle"],
    ["inp", "processing", null],
    ["cls", "v", 101],
    ["cls", "largest", -0.1],
    ["cls", "src", "a0b1c2d3"],
    ["cls", "src", ["a0b1c2d3", "NOPE"]],
    ["cls", "src", ["a0b1c2d3", "a0b1c2d4", "a0b1c2d5", "a0b1c2d6", "a0b1c2d7", "a0b1c2d8"]],
    ["fcp", "ttfb", undefined],
    ["ttfb", "dns", -3],
  ] as const)("rejects m.%s.%s = %p", (metric, key, value) => {
    const b = clone(full);
    (b.m[metric] as unknown as Record<string, unknown>)[key] = value;
    const issues = issuesOf(b);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(`m.${metric}.${key}`);
  });

  it.each([
    ["url", "https://example.com/app.js?token=secret"],
    ["url", "https://example.com/app.js#x"],
    ["url", "blob:https://example.com/123"],
    ["url", "chrome-extension://abc/x.js"],
    ["dur", -1],
    ["part", "render"],
  ] as const)("rejects m.inp.script.%s = %p", (key, value) => {
    const b = clone(full);
    (b.m.inp?.script as unknown as Record<string, unknown>)[key] = value;
    expect(issuesOf(b).map((i) => i.path)).toEqual([`m.inp.script.${key}`]);
  });

  it("rejects a metric that is not an object", () => {
    expect(issuesOf({ ...minimal, m: { lcp: 2000 } })).toEqual([
      { path: "m.lcp", message: "not an object" },
    ]);
  });

  it("collects several issues, capped at 20", () => {
    const bad = { v: 1, pk: 1, bid: 1, p: 1, nav: 1, sid: 1, sr: 1, m: {} };
    expect(issuesOf(bad).map((i) => i.path)).toEqual(["pk", "bid", "p", "nav", "sid"]);
    const many: Record<string, unknown> = {};
    for (const k of ["lcp", "inp", "cls", "fcp", "ttfb"]) many[k] = {};
    expect(issuesOf({ ...minimal, m: many })).toHaveLength(18);
    expect(issuesOf({ ...bad, m: many })).toHaveLength(20);
  });

  it("isBeacon is a type guard", () => {
    expect(isBeacon(full)).toBe(true);
    expect(isBeacon({ ...full, sr: 2 })).toBe(false);
  });
});

describe("encodeBeacon / decodeBeacon", () => {
  it("round-trips through a string", () => {
    expect(decodeBeacon(encodeBeacon(full))).toEqual({ ok: true, value: full });
  });

  it("round-trips through bytes", () => {
    const bytes = new TextEncoder().encode(encodeBeacon(full));
    expect(decodeBeacon(bytes)).toEqual({ ok: true, value: full });
    expect(decodeBeacon(bytes.buffer as ArrayBuffer)).toEqual({ ok: true, value: full });
  });

  it("encodes compactly: a full beacon stays well under 1 KB", () => {
    const s = encodeBeacon(full);
    expect(s).not.toContain("\n");
    expect(new TextEncoder().encode(s).byteLength).toBeLessThan(1024);
  });

  it("rejects invalid JSON without throwing", () => {
    expect(decodeBeacon("{not json")).toEqual({
      ok: false,
      issues: [{ path: "", message: "invalid JSON" }],
    });
  });

  it("rejects oversized bodies before parsing", () => {
    const big = JSON.stringify({ ...minimal, pad: "x".repeat(MAX_BEACON_BYTES) });
    const r = decodeBeacon(big);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]?.message).toMatch(/larger than/);
    expect(decodeBeacon(new TextEncoder().encode(big)).ok).toBe(false);
  });

  it("measures multi-byte strings in UTF-8 bytes, not characters", () => {
    // 3000 three-byte chars = 9000 bytes > limit, though only 3000 UTF-16 units.
    const s = JSON.stringify({ ...minimal, pad: "€".repeat(3000) });
    expect(s.length).toBeLessThan(MAX_BEACON_BYTES);
    expect(decodeBeacon(s).ok).toBe(false);
  });

  it("accepts a body just under the limit and strips its padding", () => {
    const base = JSON.stringify({ ...minimal, pad: "" });
    const s = JSON.stringify({ ...minimal, pad: "x".repeat(MAX_BEACON_BYTES - base.length) });
    expect(s.length).toBe(MAX_BEACON_BYTES);
    expect(decodeBeacon(s)).toEqual({ ok: true, value: minimal });
  });
});
