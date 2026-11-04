import { validateBeacon } from "@regresso/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clsEntry, inpEntry, lcpEntry, nearestComponent, scriptUrl } from "../src/attribution.js";

type Cb = (m: unknown) => void;
const cbs: Record<string, Cb> = {};
const optsSeen: unknown[] = [];

vi.mock("web-vitals/attribution", () => {
  const reg = (name: string) => (cb: Cb, opts: unknown) => {
    cbs[name] = cb;
    optsSeen.push(opts);
  };
  return {
    onTTFB: reg("TTFB"),
    onFCP: reg("FCP"),
    onLCP: reg("LCP"),
    onINP: reg("INP"),
    onCLS: reg("CLS"),
  };
});

describe("nearestComponent", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-cwv="abc12345">
        <div><button id="b">Add <span id="s">to cart</span></button></div>
        <div data-cwv="zzz99999"><p id="inner">hi</p></div>
      </section>
      <footer id="untagged"><a id="link">x</a></footer>
      <div data-cwv="NOT VALID"><i id="bad"></i></div>`;
  });

  it("walks to the nearest tagged ancestor", () => {
    expect(nearestComponent(document.getElementById("s"))).toBe("abc12345");
    expect(nearestComponent(document.getElementById("inner"))).toBe("zzz99999");
  });

  it("returns the element's own tag", () => {
    expect(nearestComponent(document.querySelector("section"))).toBe("abc12345");
  });

  it("handles text nodes", () => {
    const text = document.getElementById("b")?.firstChild ?? null;
    expect(text?.nodeType).toBe(3);
    expect(nearestComponent(text)).toBe("abc12345");
  });

  it('returns "" when untagged, null, or the tag is malformed', () => {
    expect(nearestComponent(document.getElementById("link"))).toBe("");
    expect(nearestComponent(null)).toBe("");
    expect(nearestComponent(document.getElementById("bad"))).toBe("");
  });
});

describe("scriptUrl", () => {
  it("strips query and fragment", () => {
    expect(scriptUrl("https://cdn.example.com/a/b.js?token=secret#x")).toBe(
      "https://cdn.example.com/a/b.js",
    );
  });
  it.each(["", undefined, "blob:https://x.test/1", "chrome-extension://abc/x.js", "not a url"])(
    "drops %p",
    (u) => expect(scriptUrl(u)).toBeUndefined(),
  );
  it("drops very long URLs", () => {
    expect(scriptUrl(`https://x.test/${"a".repeat(600)}`)).toBeUndefined();
  });
});

describe("metric mapping", () => {
  it("maps LCP, rounding and dropping selector targets", () => {
    const img = document.createElement("img");
    const e = lcpEntry({
      value: 2140.6,
      attribution: {
        target: "div#user-4821 > img.avatar",
        lcpEntry: { element: img },
        timeToFirstByte: 320.2,
        resourceLoadDelay: 110,
        resourceLoadDuration: 900,
        elementRenderDelay: 810.4,
      },
    } as never);
    expect(e).toEqual({
      v: 2141,
      el: "img",
      ttfb: 320,
      loadDelay: 110,
      loadDuration: 900,
      renderDelay: 810,
    });
    expect("c" in e).toBe(false);
  });

  it("maps INP with the longest script", () => {
    const e = inpEntry({
      value: 344,
      attribution: {
        interactionTarget: "abc12345",
        interactionType: "pointer",
        inputDelay: 12,
        processingDuration: 290,
        presentationDelay: 42,
        loadState: "complete",
        longestScript: {
          entry: { sourceURL: "https://example.com/app.js?v=1" },
          intersectingDuration: 270,
          subpart: "processing-duration",
        },
      },
    } as never);
    expect(e).toEqual({
      v: 344,
      c: "abc12345",
      type: "pointer",
      inputDelay: 12,
      processing: 290,
      presentation: 42,
      load: "complete",
      script: { url: "https://example.com/app.js", dur: 270, part: "processing-duration" },
    });
  });

  it("maps CLS sources to deduplicated component ids", () => {
    document.body.innerHTML = `<div data-cwv="aaaaaaaa"><p id="a"></p><p id="b"></p></div>
      <div data-cwv="bbbbbbbb"><p id="c"></p></div><p id="d"></p>`;
    const node = (id: string) => ({ node: document.getElementById(id) });
    const e = clsEntry({
      value: 0.123456,
      attribution: {
        largestShiftTarget: "aaaaaaaa",
        largestShiftValue: 0.1,
        largestShiftEntry: { sources: [node("a"), node("b"), node("c"), node("d")] },
      },
    } as never);
    expect(e).toEqual({ v: 0.1235, c: "aaaaaaaa", src: ["aaaaaaaa", "bbbbbbbb"], largest: 0.1 });
  });

  it("clamps out-of-range values into the protocol bounds", () => {
    const e = clsEntry({ value: 500, attribution: {} } as never);
    expect(e).toEqual({ v: 100 });
  });
});

describe("initRegresso", () => {
  const sendBeacon = vi.fn((_url: string, _body: string) => true);

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(cbs)) delete cbs[k];
    optsSeen.length = 0;
    sendBeacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    history.replaceState(null, "", "/products/blue-shoe?email=a@b.c#top");
  });

  afterEach(() => vi.restoreAllMocks());

  const hide = () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  const fire = (name: string, m: Record<string, unknown>) =>
    cbs[name]?.({ navigationId: 1, navigationType: "navigate", ...m });

  const ttfb = {
    value: 300,
    attribution: {
      waitingDuration: 1,
      cacheDuration: 0,
      dnsDuration: 2,
      connectionDuration: 3,
      requestDuration: 294,
    },
  };

  async function start(opts: Record<string, unknown> = {}) {
    const mod = await import("../src/index.js");
    mod.initRegresso({
      publicKey: "pk_test1234abcd",
      endpoint: "https://in.example.com/b",
      buildId: "b1",
      ...opts,
    });
    return mod;
  }

  function sentBeacons() {
    return sendBeacon.mock.calls.map(([url, body]) => {
      expect(url).toBe("https://in.example.com/b");
      expect(typeof body).toBe("string");
      const r = validateBeacon(JSON.parse(body));
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      return r.value;
    });
  }

  it("passes the nearest-component walker to web-vitals", async () => {
    await start();
    expect(Object.keys(cbs).sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
    document.body.innerHTML = `<div data-cwv="abc12345"><b id="x"></b></div>`;
    for (const o of optsSeen) {
      const gen = (o as { generateTarget: (n: Node | null) => string }).generateTarget;
      expect(gen(document.getElementById("x"))).toBe("abc12345");
    }
  });

  it("sends one valid beacon per page view on hide, with the pathname only", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.49);
    await start({ sampleRate: 0.5, consent: "granted" });
    fire("TTFB", ttfb);
    fire("FCP", { value: 900, attribution: { timeToFirstByte: 300 } });
    hide();
    hide(); // nothing new: no second beacon
    const [b, ...rest] = sentBeacons();
    expect(rest).toHaveLength(0);
    expect(b).toMatchObject({ v: 1, bid: "b1", p: "/products/blue-shoe", nav: "navigate", q: 0 });
    expect(b?.m).toEqual({
      ttfb: { v: 300, wait: 1, cache: 0, dns: 2, conn: 3, req: 294 },
      fcp: { v: 900, ttfb: 300 },
    });
    expect(JSON.stringify(b)).not.toMatch(/email|top|a@b/);
  });

  it("includes metrics web-vitals reports from listeners added after ours", async () => {
    await start();
    fire("TTFB", ttfb);
    // web-vitals adds some visibilitychange listeners lazily, i.e. after init registered its own.
    addEventListener("visibilitychange", () => fire("CLS", { value: 0.3, attribution: {} }), {
      capture: true,
      once: true,
    });
    hide();
    const sent = sentBeacons();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.m.cls).toEqual({ v: 0.3 });
  });

  it("re-sends a fuller snapshot with q+1 when metrics change after a hide", async () => {
    await start();
    fire("TTFB", ttfb);
    hide();
    fire("CLS", { value: 0.2, attribution: {} });
    hide();
    const [a, b] = sentBeacons();
    expect(a?.sid).toBe(b?.sid);
    expect([a?.q, b?.q]).toEqual([0, 1]);
    expect(b?.m.cls).toEqual({ v: 0.2 });
    expect(b?.m.ttfb).toBeDefined();
  });

  it("starts a new page view (new sid) on bfcache restore", async () => {
    await start();
    fire("TTFB", ttfb);
    fire("FCP", {
      navigationId: 2,
      navigationType: "back-forward-cache",
      value: 5,
      attribution: {},
    });
    hide();
    const [a, b] = sentBeacons();
    expect(a?.sid).not.toBe(b?.sid);
    expect(b).toMatchObject({ nav: "back-forward-cache", q: 0, m: { fcp: { v: 5, ttfb: 0 } } });
  });

  it("measures but holds beacons while consent is pending, then sends on hide", async () => {
    const { setConsent } = await start({ consent: "pending" });
    expect(Object.keys(cbs)).toHaveLength(5);
    fire("TTFB", ttfb);
    setConsent(true); // not hidden yet: nothing to flush, the beacon goes at the next hide
    expect(sendBeacon).not.toHaveBeenCalled();
    hide();
    expect(sentBeacons()).toHaveLength(1);
  });

  it("flushes a beacon held at a hide as soon as consent is granted", async () => {
    const { setConsent } = await start({ consent: "pending" });
    fire("TTFB", ttfb);
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
    setConsent(true);
    expect(sentBeacons()).toHaveLength(1);
    setConsent(true); // nothing new
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("holds again after consent is withdrawn", async () => {
    const { setConsent } = await start();
    fire("TTFB", ttfb);
    setConsent(false);
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("lets setConsent before initRegresso win over the consent option", async () => {
    const mod = await import("../src/index.js");
    mod.setConsent(false);
    mod.initRegresso({ publicKey: "pk_test1234abcd", buildId: "b1", consent: "granted" });
    fire("TTFB", ttfb);
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("defaults to the injected build constants, then the public ingest", async () => {
    vi.stubGlobal("__REGRESSO_BUILD__", { buildId: "inj1", publicKey: "pk_injected123" });
    const mod = await import("../src/index.js");
    mod.initRegresso();
    fire("TTFB", ttfb);
    hide();
    const [url, body] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toBe(mod.DEFAULT_ENDPOINT);
    expect(JSON.parse(body as string)).toMatchObject({ pk: "pk_injected123", bid: "inj1" });
    vi.unstubAllGlobals();
  });

  it.each([
    [{ publicKey: undefined }, "publicKey"],
    [{ buildId: undefined }, "buildId"],
    [{ sampleRate: 2 }, "sampleRate"],
  ])("warns and does nothing when %o", async (opts, word) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await start(opts);
    expect(Object.keys(cbs)).toHaveLength(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain(word);
  });

  it("logs each beacon with debug: true", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await start({ debug: true });
    fire("TTFB", ttfb);
    hide();
    const beaconLog = info.mock.calls.find((c) => c[1] === "beacon");
    expect(beaconLog?.[2]).toMatchObject({ v: 1, bid: "b1", m: { ttfb: { v: 300 } } });
  });

  it("logs nothing without debug", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await start();
    fire("TTFB", ttfb);
    hide();
    expect(info).not.toHaveBeenCalled();
  });

  it("registers nothing when the page is not sampled", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await start({ sampleRate: 0.1 });
    expect(Object.keys(cbs)).toHaveLength(0);
  });

  it("records the sample rate on each beacon", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    await start({ sampleRate: 0.1 });
    fire("TTFB", ttfb);
    hide();
    expect(sentBeacons()[0]?.sr).toBe(0.1);
  });

  it("falls back to fetch keepalive when sendBeacon refuses", async () => {
    sendBeacon.mockReturnValueOnce(false);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchMock);
    await start();
    fire("TTFB", ttfb);
    hide();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://in.example.com/b");
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(validateBeacon(JSON.parse(init.body as string)).ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it("ignores a second initRegresso", async () => {
    const { initRegresso } = await start();
    initRegresso({ publicKey: "pk_other1234abcd", endpoint: "https://x.test", buildId: "b2" });
    expect(optsSeen).toHaveLength(5);
  });
});
