import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const x = JSON.parse(await readFile(path, "utf8"));
    return typeof x === "object" && x !== null ? x : {};
  } catch {
    return {};
  }
}

/** Segments that don't appear in the URL: route groups `(shop)` and parallel-route slots `@modal`. */
const HIDDEN_SEGMENT = /^(?:\(.*\)|@.*)$/;
/** Intercepting routes `(.)x`, `(..)x`, `(...)x` render another route's URL; that route is listed. */
const INTERCEPTING = /^\(\.{1,3}\)/;

function joinBase(basePath: string, route: string): string {
  if (!basePath) return route;
  return route === "/" ? basePath : `${basePath}${route}`;
}

/**
 * App Router entry (`/products/[slug]/page`, `/(shop)/cart/page`) → URL template
 * (`/products/[slug]`, `/cart`), or null for route handlers, metadata routes, interception routes
 * and Next's own pages.
 */
export function appRoute(entry: string): string | null {
  const parts = entry.split("/").filter(Boolean);
  if (parts.pop() !== "page") return null;
  if (parts.some((p) => INTERCEPTING.test(p))) return null;
  const visible = parts.filter((p) => !HIDDEN_SEGMENT.test(p));
  if (visible[0]?.startsWith("_")) return null; // _not-found, _global-error
  return `/${visible.join("/")}`;
}

/** Pages Router entry (`/blog/[slug]`) → template, or null for API routes and `_app`, `404`… */
export function pagesRoute(entry: string): string | null {
  if (!entry.startsWith("/")) return null;
  const first = entry.split("/")[1] ?? "";
  if (first.startsWith("_") || first === "api" || entry === "/404" || entry === "/500") return null;
  return entry;
}

/**
 * Page route templates of a Next.js build, from `server/app-paths-manifest.json` and
 * `server/pages-manifest.json` (both written by the compiler, before static generation), with route
 * groups stripped and `basePath` prepended so they match `location.pathname`.
 */
export async function readNextRoutes(distDir: string, basePath = ""): Promise<string[]> {
  const [app, pages] = await Promise.all([
    readJson(join(distDir, "server", "app-paths-manifest.json")),
    readJson(join(distDir, "server", "pages-manifest.json")),
  ]);
  const out = new Set<string>();
  for (const k of Object.keys(app)) {
    const r = appRoute(k);
    if (r) out.add(joinBase(basePath, r));
  }
  for (const k of Object.keys(pages)) {
    const r = pagesRoute(k);
    if (r) out.add(joinBase(basePath, r));
  }
  return [...out].sort();
}
