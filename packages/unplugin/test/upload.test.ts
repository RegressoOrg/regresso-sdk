import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { BuildUploadV1 } from "@regresso/protocol";
import { describe, expect, it, vi } from "vitest";
import { finalizeBuild } from "../src/finalize.js";
import { writeManifest } from "../src/manifest.js";
import { RegressoUploadError, uploadBuild, uploadConfigFromEnv } from "../src/upload.js";

const payload: BuildUploadV1 = {
  v: 1,
  framework: "next",
  buildId: "a03fc282419b-mw19kh7c39cb",
  gitSha: "a03fc282419bfd1453dfccc9d2f4e20a77d8e543",
  branch: "main",
  env: "production",
  createdAt: "2026-11-04T12:00:00.000Z",
  components: [
    {
      id: "grnw4oy7",
      name: "AddToCart",
      file: "components/add-to-cart.tsx",
      line: 6,
      contentHash: "25d14e0d8eb550a3",
    },
  ],
  routes: ["/"],
};

const TOKEN = "sk_test_abcdefghijklmnop";
const log = () => ({ info: vi.fn(), warn: vi.fn() });
const created = () =>
  new Response(JSON.stringify({ buildId: payload.buildId, projectId: "prj_1" }), { status: 201 });

const base = (over: Record<string, unknown> = {}) => ({
  token: TOKEN,
  apiUrl: "https://api.example.com",
  strict: false,
  sleep: async () => {},
  log: log(),
  ...over,
});

describe("uploadConfigFromEnv", () => {
  it("defaults the API URL and reads strict mode", () => {
    expect(uploadConfigFromEnv({})).toEqual({
      token: undefined,
      apiUrl: "https://app.regresso.dev",
      strict: false,
    });
    expect(
      uploadConfigFromEnv({
        REGRESSO_BUILD_TOKEN: ` ${TOKEN} `,
        REGRESSO_API_URL: "http://localhost:3000/",
        REGRESSO_STRICT: "1",
      }),
    ).toEqual({ token: TOKEN, apiUrl: "http://localhost:3000", strict: true });
  });
});

describe("uploadBuild", () => {
  it("POSTs gzip-encoded JSON with the bearer token", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => created());
    const opts = base({ fetch });
    const r = await uploadBuild(payload, opts as never);
    expect(r).toEqual({ status: "uploaded", buildId: payload.buildId, projectId: "prj_1" });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/builds");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["content-encoding"]).toBe("gzip");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(gunzipSync(init.body as Uint8Array).toString())).toEqual(payload);
    expect(opts.log.info).toHaveBeenCalledOnce();
  });

  it("retries network errors and 5xx with backoff, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(created());
    const r = await uploadBuild(
      payload,
      base({ fetch, sleep, backoff: (n: number) => n * 10 }) as never,
    );
    expect(r.status).toBe("uploaded");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("honours Retry-After on 429", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(created());
    await uploadBuild(payload, base({ fetch, sleep }) as never);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("does not retry other 4xx, and fails open with a warning", async () => {
    const fetch = vi.fn(async () => new Response("bad token", { status: 401 }));
    const opts = base({ fetch });
    const r = await uploadBuild(payload, opts as never);
    expect(fetch).toHaveBeenCalledOnce();
    expect(r.status).toBe("failed");
    expect(String(opts.log.warn.mock.calls[0]?.[0])).toMatch(/HTTP 401.*REGRESSO_BUILD_TOKEN/);
    expect(String(opts.log.warn.mock.calls[0]?.[0])).not.toContain(TOKEN);
  });

  it("gives up after the last attempt", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    const r = await uploadBuild(payload, base({ fetch, attempts: 3 }) as never);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ status: "failed", reason: "HTTP 500 (after 3 attempts)" });
  });

  it("throws in strict mode", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      uploadBuild(payload, base({ fetch, attempts: 1, strict: true }) as never),
    ).rejects.toThrow(RegressoUploadError);
  });

  it("skips without a token and rejects non-build tokens", async () => {
    const fetch = vi.fn();
    expect((await uploadBuild(payload, base({ fetch, token: undefined }) as never)).status).toBe(
      "skipped",
    );
    expect((await uploadBuild(payload, base({ fetch, token: "pk_live_x" }) as never)).status).toBe(
      "failed",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates the payload before sending it", async () => {
    const fetch = vi.fn();
    const r = await uploadBuild({ ...payload, env: "staging" } as never, base({ fetch }) as never);
    expect(r).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/^invalid manifest: env/),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("finalizeBuild", () => {
  it("adds routes, writes the manifest and uploads it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "regresso-fin-"));
    const { components, routes: _r, createdAt: _c, v: _v, ...meta } = payload;
    await writeManifest(dir, "client", meta, components);
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => created());
    const r = await finalizeBuild(dir, { ...base({ fetch }), routes: ["/b", "/", "/b"] } as never);
    expect(r.status).toBe("uploaded");
    const sent = JSON.parse(gunzipSync(fetch.mock.calls[0]?.[1].body as Uint8Array).toString());
    expect(sent.routes).toEqual(["/", "/b"]);
    expect(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))).toEqual(sent);
  });

  it("skips quietly without a manifest or a token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "regresso-fin-"));
    const l = log();
    expect((await finalizeBuild(dir, { token: undefined, log: l } as never)).status).toBe(
      "skipped",
    );
    expect(l.warn).not.toHaveBeenCalled();
  });
});
