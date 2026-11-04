import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";
import { type BuildUploadV1, validateBuildUpload } from "@regresso/protocol";

const gzip = promisify(gzipCb);

declare const __VERSION__: string;

export const DEFAULT_API_URL = "https://app.regresso.dev";

/** Upload settings, normally read from the environment by {@link uploadConfigFromEnv}. */
export interface UploadConfig {
  /** Secret build token (`sk_…`) for the project. No token, no upload. */
  token: string | undefined;
  /** API origin. Default {@link DEFAULT_API_URL}. */
  apiUrl: string;
  /** Fail the build when the upload fails. Default false: warn and carry on. */
  strict: boolean;
}

export function uploadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): UploadConfig {
  return {
    token: env.REGRESSO_BUILD_TOKEN?.trim() || undefined,
    apiUrl: (env.REGRESSO_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ""),
    strict: env.REGRESSO_STRICT === "1" || env.REGRESSO_STRICT === "true",
  };
}

export interface UploadOptions extends Partial<UploadConfig> {
  /** Attempts in total, including the first. Default 4. */
  attempts?: number;
  /** Delay before retry n (1-based), in ms. Default 1 s, 2 s, 4 s… with ±20 % jitter. */
  backoff?: (retry: number) => number;
  /** Per-attempt timeout, ms. Default 30 s. */
  timeout?: number;
  /** For tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: Pick<Console, "info" | "warn">;
}

export type UploadResult =
  | { status: "uploaded"; buildId: string; projectId: string | undefined }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/** Thrown in strict mode (`REGRESSO_STRICT=1`) so the bundler fails the build. */
export class RegressoUploadError extends Error {
  override name = "RegressoUploadError";
}

const defaultBackoff = (retry: number) => 1000 * 2 ** (retry - 1) * (0.8 + Math.random() * 0.4);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 408, 425, 429 and 5xx are worth retrying; other 4xx mean the request itself is wrong. */
const retryable = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.min(s * 1000, 30_000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 30_000) : undefined;
}

function explain(status: number, body: string): string {
  const detail = body.slice(0, 200).trim();
  const hint =
    status === 401 || status === 403
      ? " (check REGRESSO_BUILD_TOKEN: it must be the build token of this project)"
      : status === 404
        ? " (check REGRESSO_API_URL)"
        : "";
  return `HTTP ${status}${hint}${detail ? `: ${detail}` : ""}`;
}

/**
 * Uploads a build to `{apiUrl}/v1/builds` as gzip-encoded JSON, retrying transient failures with
 * backoff. Fails open: problems are logged and returned, never thrown, unless `strict` is set.
 * Does nothing without a token.
 */
export async function uploadBuild(
  payload: BuildUploadV1,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const config = { ...uploadConfigFromEnv(), ...stripUndefined(options) };
  const log = options.log ?? console;
  const fail = (reason: string): UploadResult => {
    const message = `[regresso] build upload failed: ${reason}`;
    if (config.strict) throw new RegressoUploadError(message);
    log.warn(`${message}. The build continues; set REGRESSO_STRICT=1 to fail it instead.`);
    return { status: "failed", reason };
  };

  if (!config.token) return { status: "skipped", reason: "REGRESSO_BUILD_TOKEN is not set" };
  if (!config.token.startsWith("sk_")) {
    return fail("REGRESSO_BUILD_TOKEN does not look like a build token (sk_…)");
  }

  const checked = validateBuildUpload(payload);
  if (!checked.ok) {
    const first = checked.issues.slice(0, 3).map((i) => `${i.path || "(root)"} ${i.message}`);
    return fail(`invalid manifest: ${first.join("; ")}`);
  }

  let url: string;
  try {
    url = new URL("/v1/builds", `${config.apiUrl}/`).href;
  } catch {
    return fail(`REGRESSO_API_URL is not a URL: ${config.apiUrl}`);
  }

  const body = await gzip(JSON.stringify(checked.value));
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const backoff = options.backoff ?? defaultBackoff;
  const attempts = Math.max(1, options.attempts ?? 4);
  let last = "";
  let tried = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    tried = attempt;
    let wait: number | undefined;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          "content-encoding": "gzip",
          "user-agent": `regresso-unplugin/${typeof __VERSION__ === "string" ? __VERSION__ : "dev"}`,
        },
        body,
        signal: AbortSignal.timeout(options.timeout ?? 30_000),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          buildId?: string;
          projectId?: string;
        };
        const buildId = json.buildId ?? payload.buildId;
        log.info(
          `[regresso] uploaded build ${buildId} (${payload.components.length} components, ${payload.routes.length} routes${json.projectId ? `, project ${json.projectId}` : ""})`,
        );
        return { status: "uploaded", buildId, projectId: json.projectId };
      }
      last = explain(res.status, await res.text().catch(() => ""));
      if (!retryable(res.status)) break;
      wait = retryAfter(res);
    } catch (err) {
      last = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    if (attempt < attempts) await sleep(wait ?? backoff(attempt));
  }
  return fail(tried > 1 ? `${last} (after ${tried} attempts)` : last);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in o) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
