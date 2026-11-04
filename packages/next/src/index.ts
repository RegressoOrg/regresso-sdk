import { isAbsolute, join, sep } from "node:path";
import { PUBLIC_KEY_RE } from "@regresso/protocol";
import {
  detectBuildContext,
  finalizeBuild,
  makeBuildId,
  type RegressoPluginOptions,
  regresso,
  repoRoot,
} from "@regresso/unplugin";
import type { NextConfig } from "next";
import { readNextRoutes } from "./routes.js";

export { appRoute, pagesRoute, readNextRoutes } from "./routes.js";

/** The public env variable holding the project's public key. */
export const PUBLIC_KEY_ENV = "NEXT_PUBLIC_REGRESSO_KEY";

export interface WithRegressoOptions {
  /** Turn tagging, the manifest and the upload off, e.g. `enabled: process.env.CI === "true"`. Default true. */
  enabled?: boolean;
  /** Root that component paths are relative to. Default: the git repository root. */
  root?: string;
  /** Files to tag. Default: `.jsx`, `.tsx` and `.js` files inside the Next.js project directory. */
  include?: RegExp;
  exclude?: RegExp;
  /** Upload the manifest after `next build` when `REGRESSO_BUILD_TOKEN` is set. Default true. */
  upload?: boolean;
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

let warned = new Set<string>();
const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[regresso] ${message}`);
};

/** @internal For tests. */
export function resetWarnings(): void {
  warned = new Set();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Source files under the project dir. Workspace packages linked from elsewhere are not tagged. */
export const projectFiles = (dir: string) =>
  new RegExp(`^${escapeRe(join(dir, sep))}.*\\.(?:jsx|tsx|js)$`);

/**
 * Build id and SHA for this build. Stored in the environment so every process Next.js starts for
 * the same build (its webpack build workers re-load next.config) agrees on one build id.
 */
function buildInfo(root: string): { buildId: string; sha: string | null } {
  process.env.REGRESSO_GIT_SHA ||= detectBuildContext(process.env, root).gitSha ?? "";
  const sha = process.env.REGRESSO_GIT_SHA || null;
  process.env.REGRESSO_BUILD_ID ||= makeBuildId(sha);
  return { buildId: process.env.REGRESSO_BUILD_ID, sha };
}

function wrap(config: NextConfig, options: WithRegressoOptions): NextConfig {
  if (options.enabled === false) return config;
  const root = options.root ?? repoRoot();
  const { buildId, sha } = buildInfo(root);
  const publicKey = process.env[PUBLIC_KEY_ENV]?.trim() || undefined;
  const distDir = config.distDir ?? ".next";

  if (process.env.TURBOPACK) {
    warnOnce(
      "turbopack",
      "Turbopack is not supported yet: components are not tagged and no build id is injected. Use `next build --webpack` and `next dev --webpack`.",
    );
  }
  if (publicKey && !PUBLIC_KEY_RE.test(publicKey)) {
    warnOnce("key", `${PUBLIC_KEY_ENV} does not look like a public key (pk_…).`);
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
        framework: "next",
        buildId,
        gitSha: sha,
        include: options.include ?? projectFiles(ctx.dir),
        ...(options.exclude && { exclude: options.exclude }),
        ...(options.onManifest && { onManifest: options.onManifest }),
        manifest: writeManifest ? { dir: join(ctx.dir, distDir, "regresso"), name } : false,
        // Next runs client, server and edge compilations, possibly in worker processes; the upload
        // happens once, after all of them, in runAfterProductionCompile below.
        upload: false,
        define: { publicKey },
      }),
    );
    return out;
  };

  const userAfterCompile = config.compiler?.runAfterProductionCompile;
  const runAfterProductionCompile: NonNullable<
    NonNullable<NextConfig["compiler"]>["runAfterProductionCompile"]
  > = async (meta) => {
    await userAfterCompile?.(meta);
    const dist = isAbsolute(meta.distDir) ? meta.distDir : join(meta.projectDir, meta.distDir);
    await finalizeBuild(join(dist, "regresso"), {
      routes: await readNextRoutes(dist, config.basePath ?? ""),
      ...(options.upload === false && { upload: false }),
    });
  };

  return {
    ...config,
    webpack,
    compiler: { ...config.compiler, runAfterProductionCompile },
  };
}

/**
 * Wraps a Next.js config so the webpack build tags every component's outermost element with
 * `data-cwv`, injects the build id and public key for `@regresso/next/client`, writes
 * `<distDir>/regresso/manifest.json`, and uploads it after `next build` when
 * `REGRESSO_BUILD_TOKEN` is set.
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
