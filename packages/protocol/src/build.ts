/**
 * Build upload v1: what the build plugin POSTs to `{REGRESSO_API_URL}/v1/builds` at the end of a
 * production build, so the backend can map `data-cwv` ids and route templates back to code.
 *
 * It travels from the customer's CI to the API, never through a browser, so field names are
 * spelled out. The same compatibility rules as the beacon apply (see README): `v` is the major
 * version, and changes within a version are additive.
 */

import { BUILD_ID_RE, COMPONENT_ID_RE } from "./constants.js";
import { isObj, type Obj, pick, Reader, type ValidationResult } from "./validate.js";

/** Latest build upload version. */
export const BUILD_UPLOAD_VERSION = 1 as const;

/** Where a build is going to run. Previews are excluded from deploy detection. */
export type BuildEnv = "production" | "preview" | "development";

export const BUILD_ENVS: readonly BuildEnv[] = ["production", "preview", "development"];

/** Most components one upload may list. */
export const MAX_BUILD_COMPONENTS = 100_000;

/** Most route templates one upload may list. */
export const MAX_BUILD_ROUTES = 20_000;

/** Full or abbreviated git SHA, lower-case hex. */
export const GIT_SHA_RE: RegExp = /^[0-9a-f]{7,64}$/;

/** Git branch name: no whitespace or control characters, ≤ 255 chars. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
export const BRANCH_RE: RegExp = /^[^\s\u0000-\u001f\u007f]{1,255}$/;

/** Framework name, e.g. `next`, `vite`, `webpack`. */
export const FRAMEWORK_RE: RegExp = /^[a-z0-9][a-z0-9.-]{0,31}$/;

/** Component name as declared in source, or `default`. */
export const COMPONENT_NAME_RE: RegExp = /^[A-Za-z_$][\w$]{0,127}$/;

/** Repo-relative POSIX path: no leading `/`, no `..` segment, no control characters. */
export const SOURCE_FILE_RE: RegExp =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000-\u001f\u007f]{1,1024}$/;

/** Content hash: lower-case hex, 16–64 chars. The build plugin emits 16. */
export const CONTENT_HASH_RE: RegExp = /^[0-9a-f]{16,64}$/;

/**
 * Route template in Next.js syntax: `/`, `/products/[slug]`, `/blog/[...slug]`,
 * `/docs/[[...path]]`. Starts with `/`; no query, fragment, whitespace or route groups.
 */
export const ROUTE_TEMPLATE_RE: RegExp =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
  /^(?!.*\/\([^/]*\)(?:\/|$))\/[^?#\s\u0000-\u001f\u007f]{0,1023}$/;

/** ISO 8601 UTC timestamp, as made by `Date.prototype.toISOString`. */
export const ISO_TIMESTAMP_RE: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/** One component found by the build plugin. */
export interface BuildComponentV1 {
  /** The `data-cwv` value. Stable across builds: a hash of (file, name). */
  id: string;
  /** Declared name, or `default` for an anonymous default export. */
  name: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** Hash of the component's source file; differs between two builds when the file changed. */
  contentHash: string;
}

export interface BuildUploadV1 {
  v: 1;
  /** Which adapter or bundler produced the build, e.g. `next`. */
  framework: string;
  /** The build id injected into the bundle; every beacon from this build carries it as `bid`. */
  buildId: string;
  /** Commit being built, or null outside git. */
  gitSha: string | null;
  /** Branch being built, or null when unknown (detached HEAD, tag build). */
  branch: string | null;
  env: BuildEnv;
  /** When the upload was made, ISO 8601 UTC. */
  createdAt: string;
  /** Sorted by file, then line. */
  components: BuildComponentV1[];
  /** Route templates the app serves pages on, Next.js syntax, route groups stripped. May be empty. */
  routes: string[];
}

/** Every build upload version this package can decode. Discriminated by `v`. */
export type BuildUpload = BuildUploadV1;

/** Validator and type guard results use the same shape as the beacon's. */
export type BuildUploadResult = ValidationResult<BuildUpload>;

function nullable(r: Reader, src: Obj, key: string, re: RegExp): string | null | undefined {
  const x = src[key];
  if (x === null) return null;
  if (x === undefined) return r.fail(key, "required (use null when unknown)");
  if (typeof x !== "string" || !re.test(x)) return r.fail(key, "invalid format");
  return x;
}

/**
 * Validates an already-parsed build upload. Like {@link validateBeacon}: returns a fresh object
 * holding only known fields, collects up to 20 issues, never throws.
 */
export function validateBuildUpload(input: unknown): BuildUploadResult {
  if (!isObj(input)) return { ok: false, issues: [{ path: "", message: "not an object" }] };
  if (input.v !== BUILD_UPLOAD_VERSION) {
    return { ok: false, issues: [{ path: "v", message: "unsupported version" }] };
  }
  const r = new Reader();

  const components: BuildComponentV1[] = [];
  const rawComponents = input.components;
  if (!Array.isArray(rawComponents)) r.fail("components", "expected an array");
  else if (rawComponents.length > MAX_BUILD_COMPONENTS) {
    r.fail("components", `more than ${MAX_BUILD_COMPONENTS} components`);
  } else {
    for (const [i, c] of rawComponents.entries()) {
      const p = `components.${i}.`;
      if (!isObj(c)) {
        r.fail(p.slice(0, -1), "not an object");
        continue;
      }
      const line = c.line;
      const okLine = Number.isInteger(line) && (line as number) >= 1 && (line as number) <= 1e7;
      if (!okLine) r.fail(`${p}line`, "expected a positive integer");
      components.push(
        pick<BuildComponentV1>([
          ["id", r.str(c, "id", p, COMPONENT_ID_RE, true)],
          ["name", r.str(c, "name", p, COMPONENT_NAME_RE, true)],
          ["file", r.str(c, "file", p, SOURCE_FILE_RE, true)],
          ["line", okLine ? line : undefined],
          ["contentHash", r.str(c, "contentHash", p, CONTENT_HASH_RE, true)],
        ]),
      );
    }
  }

  let routes: string[] = [];
  const rawRoutes = input.routes;
  if (!Array.isArray(rawRoutes)) r.fail("routes", "expected an array");
  else if (rawRoutes.length > MAX_BUILD_ROUTES) {
    r.fail("routes", `more than ${MAX_BUILD_ROUTES} routes`);
  } else {
    rawRoutes.forEach((t, i) => {
      if (typeof t !== "string" || !ROUTE_TEMPLATE_RE.test(t))
        r.fail(`routes.${i}`, "invalid route template");
    });
    routes = rawRoutes.slice() as string[];
  }

  const value = pick<BuildUploadV1>([
    ["v", 1],
    ["framework", r.str(input, "framework", "", FRAMEWORK_RE, true)],
    ["buildId", r.str(input, "buildId", "", BUILD_ID_RE, true)],
    ["gitSha", nullable(r, input, "gitSha", GIT_SHA_RE)],
    ["branch", nullable(r, input, "branch", BRANCH_RE)],
    ["env", r.oneOf(input, "env", "", BUILD_ENVS, true)],
    ["createdAt", r.str(input, "createdAt", "", ISO_TIMESTAMP_RE, true)],
    ["components", components],
    ["routes", routes],
  ]);
  return r.issues.length ? { ok: false, issues: r.issues } : { ok: true, value };
}

/** Type guard form of {@link validateBuildUpload}. Does not strip unknown fields. */
export function isBuildUpload(input: unknown): input is BuildUpload {
  return validateBuildUpload(input).ok;
}
