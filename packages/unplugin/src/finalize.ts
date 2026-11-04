import { readManifest, saveManifest, sortRoutes } from "./manifest.js";
import {
  type UploadOptions,
  type UploadResult,
  uploadBuild,
  uploadConfigFromEnv,
} from "./upload.js";

export interface FinalizeOptions extends UploadOptions {
  /** Route templates to record in the manifest (Next.js syntax). Default: keep what's there. */
  routes?: Iterable<string>;
  /** Write the manifest only. Default true when `REGRESSO_BUILD_TOKEN` is set. */
  upload?: boolean;
}

/**
 * The last step of a production build, shared by every adapter: reads `<dir>/manifest.json`
 * (merged from every compilation), adds the routes, stamps `createdAt`, writes it back and uploads
 * it. Fails open like {@link uploadBuild}.
 */
export async function finalizeBuild(
  dir: string,
  options: FinalizeOptions = {},
): Promise<UploadResult> {
  const log = options.log ?? console;
  const token = options.token ?? uploadConfigFromEnv().token;
  const manifest = await readManifest(dir);
  if (!manifest) {
    const reason = `no manifest in ${dir}: no components were tagged`;
    if (token) log.warn(`[regresso] build not uploaded: ${reason}.`);
    return { status: "skipped", reason };
  }
  if (options.routes) manifest.routes = sortRoutes(options.routes);
  manifest.createdAt = new Date().toISOString();
  await saveManifest(dir, manifest);

  if (options.upload === false) return { status: "skipped", reason: "upload disabled" };
  if (!token) {
    log.info(
      "[regresso] REGRESSO_BUILD_TOKEN is not set: the build manifest was written but not uploaded.",
    );
    return { status: "skipped", reason: "REGRESSO_BUILD_TOKEN is not set" };
  }
  return uploadBuild(manifest, { ...options, token });
}
