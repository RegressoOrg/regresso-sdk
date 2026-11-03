import { join, sep } from "node:path";
import {
  gitSha,
  makeBuildId,
  type RegressoPluginOptions,
  regresso,
  repoRoot,
} from "@regresso/unplugin";
import type { NextConfig } from "next";

export interface WithRegressoOptions {
  /** Turn tagging and the manifest off, e.g. `enabled: process.env.REGRESSO !== "0"`. Default true. */
  enabled?: boolean;
  /** Root that component paths are relative to. Default: the git repository root. */
  root?: string;
  /** Files to tag. Default: `.jsx`, `.tsx` and `.js` files inside the Next.js project directory. */
  include?: RegExp;
  exclude?: RegExp;
  /** Write the manifest in `next dev` too. Default false. */
  manifestInDev?: boolean;
  /** Called after the manifest is written, once per compilation. */
  onManifest?: RegressoPluginOptions["onManifest"];
}

type NextConfigFn = (
  phase: string,
  ctx: { defaultConfig: NextConfig },
) => NextConfig | Promise<NextConfig>;
type WebpackFn = NonNullable<NextConfig["webpack"]>;
type WebpackContext = Parameters<WebpackFn>[1];

/** The define replaced in client and server bundles. Read it through `@regresso/next/client`. */
export const BUILD_ID_DEFINE = "__REGRESSO_BUILD_ID__";

let warnedTurbopack = false;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Source files under the project dir. Workspace packages linked from elsewhere are not tagged. */
export const projectFiles = (dir: string) =>
  new RegExp(`^${escapeRe(join(dir, sep))}.*\\.(?:jsx|tsx|js)$`);

/**
 * Build id and SHA for this build. Stored in the environment so every process Next.js starts for
 * the same build (its webpack build workers re-load next.config) agrees on one build id.
 */
function buildInfo(root: string): { buildId: string; sha: string | null } {
  process.env.REGRESSO_GIT_SHA ||= gitSha(root) ?? "";
  const sha = process.env.REGRESSO_GIT_SHA || null;
  process.env.REGRESSO_BUILD_ID ||= makeBuildId(sha);
  return { buildId: process.env.REGRESSO_BUILD_ID, sha };
}

function wrap(config: NextConfig, options: WithRegressoOptions): NextConfig {
  if (options.enabled === false) return config;
  const root = options.root ?? repoRoot();
  const { buildId, sha } = buildInfo(root);

  if (process.env.TURBOPACK && !warnedTurbopack) {
    warnedTurbopack = true;
    console.warn(
      "[regresso] Turbopack is not supported yet: components will not be tagged. Build with `next build --webpack`.",
    );
  }

  const userWebpack = config.webpack;
  const webpack: WebpackFn = (wpConfig, ctx: WebpackContext) => {
    const out = userWebpack ? userWebpack(wpConfig, ctx) : wpConfig;
    const name = !ctx.isServer ? "client" : ctx.nextRuntime === "edge" ? "edge" : "server";
    const writeManifest = !ctx.dev || options.manifestInDev;
    out.plugins ??= [];
    out.plugins.push(
      regresso.webpack({
        root,
        buildId,
        gitSha: sha,
        include: options.include ?? projectFiles(ctx.dir),
        ...(options.exclude && { exclude: options.exclude }),
        ...(options.onManifest && { onManifest: options.onManifest }),
        manifest: writeManifest
          ? { dir: join(ctx.dir, config.distDir ?? ".next", "regresso"), name }
          : false,
      }),
      new ctx.webpack.DefinePlugin({ [BUILD_ID_DEFINE]: JSON.stringify(buildId) }),
    );
    return out;
  };

  return { ...config, webpack };
}

/**
 * Wraps a Next.js config so the webpack build tags every component's outermost element with
 * `data-cwv`, writes `<distDir>/regresso/manifest.json`, and injects the build id that
 * `@regresso/next/client` reports.
 */
export function withRegresso(config: NextConfig, options?: WithRegressoOptions): NextConfig;
export function withRegresso(config: NextConfigFn, options?: WithRegressoOptions): NextConfigFn;
export function withRegresso(
  config: NextConfig | NextConfigFn,
  options: WithRegressoOptions = {},
): NextConfig | NextConfigFn {
  if (typeof config === "function") {
    return async (phase, ctx) => wrap(await config(phase, ctx), options);
  }
  return wrap(config, options);
}

export default withRegresso;
