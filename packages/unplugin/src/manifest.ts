import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildComponentV1, BuildEnv, BuildUploadV1 } from "@regresso/protocol";

/** Everything in a build upload except the components and routes. */
export interface BuildMeta {
  framework: string;
  buildId: string;
  gitSha: string | null;
  branch: string | null;
  env: BuildEnv;
}

/**
 * The build manifest written to `<dir>/manifest.json`. It is exactly the payload that is
 * uploaded, so you can inspect what Regresso receives.
 */
export type BuildManifest = BuildUploadV1;

interface Fragment {
  buildId: string;
  components: BuildComponentV1[];
}

export const MANIFEST_FILE = "manifest.json";

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function sortComponents(components: Iterable<BuildComponentV1>): BuildComponentV1[] {
  const byId = new Map<string, BuildComponentV1>();
  for (const c of components) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
}

/** Deduplicated and sorted, `/` first. */
export function sortRoutes(routes: Iterable<string>): string[] {
  return [...new Set(routes)].sort();
}

export function buildManifest(
  meta: BuildMeta,
  components: Iterable<BuildComponentV1>,
  routes: Iterable<string> = [],
): BuildManifest {
  return {
    v: 1,
    framework: meta.framework,
    buildId: meta.buildId,
    gitSha: meta.gitSha,
    branch: meta.branch,
    env: meta.env,
    createdAt: new Date().toISOString(),
    components: sortComponents(components),
    routes: sortRoutes(routes),
  };
}

/** Writes `<dir>/manifest.json`. */
export async function saveManifest(dir: string, manifest: BuildManifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Reads `<dir>/manifest.json`, or null when there is none (or it doesn't parse). */
export async function readManifest(dir: string): Promise<BuildManifest | null> {
  try {
    return JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8")) as BuildManifest;
  } catch {
    return null;
  }
}

/**
 * Writes this compilation's components as `<dir>/fragments/<name>.json`, then rebuilds
 * `<dir>/manifest.json` from every fragment with the same build id.
 *
 * Fragments exist because one build can run several compilations (Next.js: client, server, edge),
 * possibly in separate processes, and each sees only some components: server components only
 * reach the server compilation.
 */
export async function writeManifest(
  dir: string,
  name: string,
  meta: BuildMeta,
  components: Iterable<BuildComponentV1>,
  routes: Iterable<string> = [],
): Promise<BuildManifest> {
  const fragDir = join(dir, "fragments");
  await mkdir(fragDir, { recursive: true });
  const fragment: Fragment = { buildId: meta.buildId, components: sortComponents(components) };
  await writeAtomic(join(fragDir, `${name}.json`), JSON.stringify(fragment));

  const all: BuildComponentV1[] = [];
  for (const f of await readdir(fragDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const other = JSON.parse(await readFile(join(fragDir, f), "utf8")) as Fragment;
      if (other.buildId === meta.buildId) all.push(...other.components);
    } catch {
      // a fragment being replaced right now; its writer rebuilds the manifest after us
    }
  }

  const manifest = buildManifest(meta, all, routes);
  await saveManifest(dir, manifest);
  return manifest;
}
