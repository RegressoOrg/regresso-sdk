import { isAbsolute, join, relative, sep } from "node:path";
import { createUnplugin, type UnpluginFactory } from "unplugin";
import { gitSha, makeBuildId, repoRoot } from "./build-info.js";
import { type BuildManifest, sortComponents, writeManifest } from "./manifest.js";
import { type ComponentRecord, transformJsx } from "./transform.js";

export { gitSha, makeBuildId, repoRoot } from "./build-info.js";
export { type BuildManifest, writeManifest } from "./manifest.js";
export {
  ATTR,
  type ComponentRecord,
  componentId,
  contentHash,
  type TransformOptions,
  type TransformResult,
  transformJsx,
} from "./transform.js";

export interface RegressoPluginOptions {
  /** Root that component paths are relative to. Default: the git repository root, else cwd. */
  root?: string;
  /** Files to tag. Default: `.jsx`, `.tsx` and `.js` outside `node_modules`. */
  include?: RegExp;
  exclude?: RegExp;
  /** Build id written to the manifest. Default: {@link makeBuildId} of the git SHA. */
  buildId?: string;
  /** Git SHA written to the manifest. Default: CI env vars, then `git rev-parse HEAD`. */
  gitSha?: string | null;
  /**
   * Where to write the manifest, or false for none. `name` distinguishes compilations that write
   * fragments of the same build (default: the bundler's name).
   * Default: `{ dir: "<cwd>/.regresso" }`.
   */
  manifest?: false | { dir: string; name?: string };
  /** Called with the merged manifest after each write. */
  onManifest?: (manifest: BuildManifest) => void;
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
  options: { name?: string };
  hooks: { thisCompilation: { tap(name: string, fn: (c: WebpackCompilationLike) => void): void } };
}

export const unpluginFactory: UnpluginFactory<RegressoPluginOptions | undefined> = (
  options = {},
  meta,
) => {
  const root = options.root ?? repoRoot();
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const sha = options.gitSha !== undefined ? options.gitSha : gitSha(root);
  const buildId = options.buildId ?? makeBuildId(sha);
  const manifestOpt =
    options.manifest === false
      ? false
      : (options.manifest ?? { dir: join(process.cwd(), ".regresso") });

  /** Components by absolute file, for bundlers without a module cache to read back from. */
  const seen = new Map<string, ComponentRecord[]>();

  const emit = async (name: string, components: Iterable<ComponentRecord>) => {
    if (!manifestOpt) return;
    const manifest = await writeManifest(manifestOpt.dir, manifestOpt.name ?? name, {
      build_id: buildId,
      git_sha: sha,
      components: sortComponents(components),
    });
    options.onManifest?.(manifest);
  };

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
      c.hooks.thisCompilation.tap("regresso", (compilation) => {
        compilation.hooks.finishModules.tapPromise("regresso", async (modules) => {
          const all: ComponentRecord[] = [];
          for (const m of modules) {
            const list = m.buildInfo?.[BUILD_INFO_KEY];
            if (Array.isArray(list)) all.push(...(list as ComponentRecord[]));
          }
          await emit(name, all);
        });
      });
    },

    async buildEnd() {
      if (meta.framework === "webpack") return;
      await emit(meta.framework, [...seen.values()].flat());
    },
  };
};

export const regresso = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default regresso;
