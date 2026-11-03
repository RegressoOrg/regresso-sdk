import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentRecord } from "./transform.js";

/** The build manifest: what the backend needs to map a `data-cwv` id back to code. */
export interface BuildManifest {
  manifest_version: 1;
  build_id: string;
  git_sha: string | null;
  /** Sorted by file, then line. */
  components: ComponentRecord[];
}

interface Fragment {
  build_id: string;
  git_sha: string | null;
  components: ComponentRecord[];
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function sortComponents(components: Iterable<ComponentRecord>): ComponentRecord[] {
  const byId = new Map<string, ComponentRecord>();
  for (const c of components) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
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
  fragment: Fragment,
): Promise<BuildManifest> {
  const fragDir = join(dir, "fragments");
  await mkdir(fragDir, { recursive: true });
  await writeAtomic(join(fragDir, `${name}.json`), JSON.stringify(fragment));

  const all: ComponentRecord[] = [];
  for (const f of await readdir(fragDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const other = JSON.parse(await readFile(join(fragDir, f), "utf8")) as Fragment;
      if (other.build_id === fragment.build_id) all.push(...other.components);
    } catch {
      // a fragment being replaced right now; its writer rebuilds the manifest after us
    }
  }

  const manifest: BuildManifest = {
    manifest_version: 1,
    build_id: fragment.build_id,
    git_sha: fragment.git_sha,
    components: sortComponents(all),
  };
  await writeAtomic(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
