import { isAbsolute, join, relative, sep } from "node:path";
import type { BuildComponentV1 } from "@regresso/protocol";
import { createUnplugin, type UnpluginFactory } from "unplugin";
import { makeBuildId, repoRoot } from "./build-info.js";
import { detectBuildContext } from "./ci.js";
import { defineConstants } from "./define.js";
import { finalizeBuild } from "./finalize.js";
import { type BuildManifest, type BuildMeta, writeManifest } from "./manifest.js";
import { transformJsx } from "./transform.js";

export { gitSha, makeBuildId, repoRoot } from "./build-info.js";
export { type BuildContext, type CiProvider, detectBuildContext } from "./ci.js";
export { DEFINE_NAME, defineConstants, type InjectedConfig } from "./define.js";
export { type FinalizeOptions, finalizeBuild } from "./finalize.js";
export {
  type BuildManifest,
  type BuildMeta,
  buildManifest,
  MANIFEST_FILE,
  readManifest,
  writeManifest,
} from "./manifest.js";
export {
  ATTR,
  type ComponentRecord,
  componentId,
  contentHash,
  type TransformOptions,
  type TransformResult,
  transformJsx,
} from "./transform.js";
export {
  DEFAULT_API_URL,
  RegressoUploadError,
  type UploadConfig,
  type UploadOptions,
  type UploadResult,
  uploadBuild,
  uploadConfigFromEnv,
} from "./upload.js";

export interface RegressoPluginOptions {
  /** Root that component paths are relative to. Default: the git repository root, else cwd. */
  root?: string;
  /** Files to tag. Default: `.jsx`, `.tsx` and `.js` outside `node_modules`. */
  include?: RegExp;
  exclude?: RegExp;
  /** Recorded in the build upload. Default: the bundler (`webpack`, `vite`, …). */
  framework?: string;
  /** Build id injected into the bundle and written to the manifest. Default: {@link makeBuildId}. */
  buildId?: string;
  /** Git SHA of the build. Default: {@link detectBuildContext}. */
  gitSha?: string | null;
  /**
   * Where to write the manifest, or false for none. `name` distinguishes compilations that write
   * fragments of the same build (default: the bundler's name).
   * Default: `{ dir: "<cwd>/.regresso" }`.
   */
  manifest?: false | { dir: string; name?: string };
  /** Called with the merged manifest after each write. */
  onManifest?: (manifest: BuildManifest) => void;
  /** Route templates for the upload (Next.js syntax), or a function that returns them. */
  routes?: string[] | (() => string[] | Promise<string[]>);
  /**
   * Upload the manifest at the end of a production build when `REGRESSO_BUILD_TOKEN` is set.
   * Default true. Adapters whose framework runs several compilations pass false and call
   * {@link finalizeBuild} once all of them are done.
   */
  upload?: boolean;
  /**
   * Inject `__REGRESSO_BUILD__` (build id, public key, endpoint) for `@regresso/browser`, on
   * webpack and Vite. `publicKey` comes from the adapter (the framework's public env variable);
   * `endpoint` defaults to `REGRESSO_INGEST_URL`. Default `{}`; false to skip.
   */
  define?: false | { publicKey?: string | undefined; endpoint?: string | undefined };
}

/** Key on webpack's `module.buildInfo`, which is persisted with the module in the build cache. */
const BUILD_INFO_KEY = "regressoComponents";

const DEFAULT_INCLUDE = /\.(?:jsx|tsx|js)$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;

const toPosix = (p: string) => p.split(sep).join("/");

// Minimal structural types for the parts of webpack used here, so webpack stays an optional peer.
interface WebpackModuleLike {
  buildInfo?: Record<string, unknown>;
}
interface WebpackCompilationLike {
  hooks: {
    finishModules: {
      tapPromise(name: string, fn: (modules: Iterable<WebpackModuleLike>) => Promise<void>): void;
    };
  };
}
interface WebpackCompilerLike {
  name?: string;
  watchMode?: boolean;
  options: { name?: string; mode?: string };
  webpack?: { DefinePlugin: new (defs: Record<string, string>) => { apply(c: unknown): void } };
  hooks: {
    thisCompilation: { tap(name: string, fn: (c: WebpackCompilationLike) => void): void };
    done: { tapPromise(name: string, fn: () => Promise<void>): void };
  };
}

export const unpluginFactory: UnpluginFactory<RegressoPluginOptions | undefined> = (
  options = {},
  meta,
) => {
  const root = options.root ?? repoRoot();
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const ctx = detectBuildContext(process.env, root);
  const sha = options.gitSha !== undefined ? options.gitSha : ctx.gitSha;
  const buildMeta: BuildMeta = {
    framework: options.framework ?? meta.framework,
    buildId: options.buildId ?? makeBuildId(sha),
    gitSha: sha,
    branch: ctx.branch,
    env: ctx.env,
  };
  const manifestOpt =
    options.manifest === false
      ? false
      : (options.manifest ?? { dir: join(process.cwd(), ".regresso") });
  const defines =
    options.define === false
      ? undefined
      : defineConstants({
          buildId: buildMeta.buildId,
          publicKey: options.define?.publicKey,
          endpoint:
            options.define?.endpoint ?? (process.env.REGRESSO_INGEST_URL?.trim() || undefined),
        });

  /** Components by absolute file, for bundlers without a module cache to read back from. */
  const seen = new Map<string, BuildComponentV1[]>();

  const routes = async () =>
    typeof options.routes === "function" ? await options.routes() : (options.routes ?? []);

  const emit = async (name: string, components: Iterable<BuildComponentV1>) => {
    if (!manifestOpt) return;
    const manifest = await writeManifest(
      manifestOpt.dir,
      manifestOpt.name ?? name,
      buildMeta,
      components,
      await routes(),
    );
    options.onManifest?.(manifest);
  };

  let finalized = false;
  const finalize = async () => {
    if (finalized || !manifestOpt || options.upload === false) return;
    finalized = true;
    await finalizeBuild(manifestOpt.dir, { routes: await routes() });
  };

  let viteBuild = false;

  return {
    name: "regresso",
    // Run before the framework compiles JSX away.
    enforce: "pre",

    transform: {
      filter: { id: { include, exclude } },
      handler(code, id) {
        const file = id.split("?")[0] ?? id;
        if (!isAbsolute(file)) return null;
        const rel = toPosix(relative(root, file));
        const result = transformJsx(code, { file: rel, filename: file });
        const components = result?.components ?? [];
        seen.set(file, components);
        const native = this.getNativeBuildContext?.();
        if (native?.framework === "webpack") {
          const mod = (native.loaderContext as { _module?: WebpackModuleLike })._module;
          if (mod?.buildInfo) mod.buildInfo[BUILD_INFO_KEY] = components;
        }
        return result && { code: result.code, map: result.map };
      },
    },

    // webpack: read components back from every module in the compilation, including modules
    // restored from the persistent cache whose loaders did not run this time. `finishModules` runs
    // once all modules are built and before module concatenation folds them into other modules.
    webpack(compiler) {
      const c = compiler as unknown as WebpackCompilerLike;
      const name = c.options.name ?? c.name ?? "webpack";
      if (defines && c.webpack?.DefinePlugin) new c.webpack.DefinePlugin(defines).apply(compiler);
      c.hooks.thisCompilation.tap("regresso", (compilation) => {
        compilation.hooks.finishModules.tapPromise("regresso", async (modules) => {
          const all: BuildComponentV1[] = [];
          for (const m of modules) {
            const list = m.buildInfo?.[BUILD_INFO_KEY];
            if (Array.isArray(list)) all.push(...(list as BuildComponentV1[]));
          }
          await emit(name, all);
        });
      });
      c.hooks.done.tapPromise("regresso", async () => {
        if (c.options.mode === "production" && !c.watchMode) await finalize();
      });
    },

    vite: {
      config: () => (defines ? { define: defines } : {}),
      configResolved(config) {
        viteBuild = config.command === "build" && !config.build.watch;
      },
    },

    async buildEnd() {
      if (meta.framework === "webpack") return;
      await emit(meta.framework, [...seen.values()].flat());
    },

    async writeBundle() {
      const rollupBuild = meta.framework === "rollup" && process.env.ROLLUP_WATCH !== "true";
      if (meta.framework === "vite" ? viteBuild : rollupBuild) {
        await finalize();
      }
    },
  };
};

export const regresso = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default regresso;
