import type { NextConfig } from "next";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_ID_DEFINE, projectFiles, withRegresso } from "../src/index.js";

class DefinePlugin {
  constructor(public definitions: Record<string, string>) {}
}

const ctx = (over: Record<string, unknown> = {}) =>
  ({ dir: "/app", dev: false, isServer: false, webpack: { DefinePlugin }, ...over }) as never;

type Cfg = { plugins: unknown[] };
const run = (config: NextConfig, c = ctx()) =>
  (config as unknown as { webpack: (cfg: Cfg, c: never) => Cfg }).webpack({ plugins: [] }, c);

describe("withRegresso", () => {
  afterEach(() => {
    delete process.env.REGRESSO_BUILD_ID;
    delete process.env.REGRESSO_GIT_SHA;
  });

  it("adds the tagging plugin and the build id define, keeping the user's webpack hook", () => {
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
    expect(out.plugins).toHaveLength(2);
    const define = out.plugins[1] as DefinePlugin;
    expect(define.definitions[BUILD_ID_DEFINE]).toBe(JSON.stringify(process.env.REGRESSO_BUILD_ID));
  });

  it("uses one build id per process, so Next's build workers agree", () => {
    const a = run(withRegresso({}), ctx({ isServer: true }));
    const b = run(withRegresso({}), ctx());
    expect((a.plugins[1] as DefinePlugin).definitions).toEqual(
      (b.plugins[1] as DefinePlugin).definitions,
    );
  });

  it("honours a build id from the environment", () => {
    process.env.REGRESSO_BUILD_ID = "from-ci-123";
    const out = run(withRegresso({}));
    expect((out.plugins[1] as DefinePlugin).definitions[BUILD_ID_DEFINE]).toBe('"from-ci-123"');
  });

  it("supports function configs", async () => {
    const fn = withRegresso(async () => ({ poweredByHeader: false }));
    const config = await fn("phase-production-build", { defaultConfig: {} });
    expect(config.poweredByHeader).toBe(false);
    expect(typeof config.webpack).toBe("function");
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
