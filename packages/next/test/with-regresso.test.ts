import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFINE_NAME, writeManifest } from "@regresso/unplugin";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appRoute,
  pagesRoute,
  projectFiles,
  readNextRoutes,
  resetWarnings,
  withRegresso,
} from "../src/index.js";

/** The define the shared plugin applies to a webpack compiler. */
function definesOf(plugin: unknown): Record<string, string> {
  let defs: Record<string, string> = {};
  class DefinePlugin {
    constructor(d: Record<string, string>) {
      defs = d;
    }
    apply() {}
  }
  const hook = { tap() {}, tapPromise() {}, tapAsync() {} };
  const hooks = new Proxy({}, { get: () => hook });
  (plugin as { apply(c: unknown): void }).apply({
    options: { name: "client", mode: "production", module: { rules: [] }, resolve: {} },
    webpack: { DefinePlugin },
    hooks,
  });
  return defs;
}

const ctx = (over: Record<string, unknown> = {}) =>
  ({ dir: "/app", dev: false, isServer: false, webpack: {}, ...over }) as never;

type Cfg = { plugins: unknown[]; module?: unknown };
const run = (config: NextConfig, c = ctx()) =>
  (config as unknown as { webpack: (cfg: Cfg, c: never) => Cfg }).webpack(
    { plugins: [], module: { rules: [] } },
    c,
  );

describe("withRegresso", () => {
  afterEach(() => {
    delete process.env.REGRESSO_BUILD_ID;
    delete process.env.REGRESSO_GIT_SHA;
    delete process.env.NEXT_PUBLIC_REGRESSO_KEY;
    delete process.env.TURBOPACK;
    resetWarnings();
    vi.restoreAllMocks();
  });

  it("adds the shared plugin and keeps the user's webpack hook and config", () => {
    let userCalled = false;
    const config = withRegresso({
      reactStrictMode: true,
      webpack: (c) => {
        userCalled = true;
        return c;
      },
    });
    expect(config.reactStrictMode).toBe(true);
    const out = run(config);
    expect(userCalled).toBe(true);
    expect(out.plugins).toHaveLength(1);
  });

  it("injects one build id per process and the public key", () => {
    process.env.NEXT_PUBLIC_REGRESSO_KEY = "pk_test_abcdefgh";
    const a = definesOf(run(withRegresso({}), ctx({ isServer: true })).plugins[0]);
    const b = definesOf(run(withRegresso({}), ctx()).plugins[0]);
    expect(a).toEqual(b);
    expect(JSON.parse(a[DEFINE_NAME] ?? "")).toEqual({
      buildId: process.env.REGRESSO_BUILD_ID,
      publicKey: "pk_test_abcdefgh",
    });
  });

  it("honours a build id from the environment", () => {
    process.env.REGRESSO_BUILD_ID = "from-ci-123";
    const defs = definesOf(run(withRegresso({})).plugins[0]);
    expect(JSON.parse(defs[DEFINE_NAME] ?? "").buildId).toBe("from-ci-123");
  });

  it("warns once about Turbopack and malformed keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.TURBOPACK = "1";
    process.env.NEXT_PUBLIC_REGRESSO_KEY = "sk_oops";
    withRegresso({});
    withRegresso({});
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/--webpack/);
    expect(String(warn.mock.calls[1]?.[0])).toMatch(/NEXT_PUBLIC_REGRESSO_KEY/);
  });

  it("supports function configs", async () => {
    const fn = withRegresso(async () => ({ poweredByHeader: false }));
    const config = await fn("phase-production-build", { defaultConfig: {} });
    expect(config.poweredByHeader).toBe(false);
    expect(typeof config.webpack).toBe("function");
    expect(typeof config.compiler?.runAfterProductionCompile).toBe("function");
  });

  it("finalizes after the production compile: routes into the manifest, then the user's hook", async () => {
    const project = await mkdtemp(join(tmpdir(), "regresso-next-"));
    const dist = join(project, ".next");
    await mkdir(join(dist, "server"), { recursive: true });
    await writeFile(
      join(dist, "server", "app-paths-manifest.json"),
      JSON.stringify({ "/page": "x", "/(shop)/products/[slug]/page": "x", "/api/x/route": "x" }),
    );
    await writeManifest(
      join(dist, "regresso"),
      "client",
      { framework: "next", buildId: "b1", gitSha: null, branch: null, env: "development" },
      [],
    );
    const user = vi.fn(async () => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const config = withRegresso({
      basePath: "/shop",
      compiler: { runAfterProductionCompile: user },
    });
    await config.compiler?.runAfterProductionCompile?.({ projectDir: project, distDir: dist });
    expect(user).toHaveBeenCalledOnce();
    const manifest = JSON.parse(await readFile(join(dist, "regresso", "manifest.json"), "utf8"));
    expect(manifest.routes).toEqual(["/shop", "/shop/products/[slug]"]);
    expect(String(info.mock.calls[0]?.[0])).toMatch(/REGRESSO_BUILD_TOKEN is not set/);
  });

  it("tags only files inside the project directory by default", () => {
    const re = projectFiles("/work/my.app");
    expect(re.test("/work/my.app/app/page.tsx")).toBe(true);
    expect(re.test("/work/my.app/components/x.js")).toBe(true);
    expect(re.test("/work/myXapp/app/page.tsx")).toBe(false);
    expect(re.test("/work/packages/ui/button.tsx")).toBe(false);
    expect(re.test("/work/my.app/lib/util.ts")).toBe(false);
  });

  it("can be disabled", () => {
    expect(withRegresso({ basePath: "/x" }, { enabled: false })).toEqual({ basePath: "/x" });
  });
});

describe("routes", () => {
  it.each([
    ["/page", "/"],
    ["/products/[slug]/page", "/products/[slug]"],
    ["/(shop)/(nested)/cart/page", "/cart"],
    ["/dashboard/@modal/settings/page", "/dashboard/settings"],
    ["/blog/[...slug]/page", "/blog/[...slug]"],
    ["/docs/[[...path]]/page", "/docs/[[...path]]"],
    ["/feed/(..)photo/[id]/page", null],
    ["/api/beacon/route", null],
    ["/favicon.ico/route", null],
    ["/_not-found/page", null],
  ])("app %s → %s", (entry, expected) => expect(appRoute(entry)).toBe(expected));

  it.each([
    ["/", "/"],
    ["/blog/[slug]", "/blog/[slug]"],
    ["/api/hello", null],
    ["/_app", null],
    ["/_error", null],
    ["/404", null],
  ])("pages %s → %s", (entry, expected) => expect(pagesRoute(entry)).toBe(expected));

  it("merges both routers and tolerates missing manifests", async () => {
    const dist = await mkdtemp(join(tmpdir(), "regresso-routes-"));
    expect(await readNextRoutes(dist)).toEqual([]);
    await mkdir(join(dist, "server"));
    await writeFile(
      join(dist, "server", "pages-manifest.json"),
      JSON.stringify({ "/old": "", "/_app": "" }),
    );
    await writeFile(
      join(dist, "server", "app-paths-manifest.json"),
      JSON.stringify({ "/page": "" }),
    );
    expect(await readNextRoutes(dist)).toEqual(["/", "/old"]);
  });
});
