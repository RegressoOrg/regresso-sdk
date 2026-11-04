import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BRANCH_RE, BUILD_ENVS, type BuildEnv } from "@regresso/protocol";

/** CI and hosting providers whose build environment is read directly. */
export type CiProvider =
  | "vercel"
  | "netlify"
  | "render"
  | "cloudflare-pages"
  | "cloudflare-workers"
  | "github-actions"
  | "gitlab-ci";

/** What is being built and where it is going, as far as the environment can tell. */
export interface BuildContext {
  /** The provider detected, or null for an unknown CI or a local build. */
  provider: CiProvider | null;
  /** Full git SHA, lower case, or null when unknown. */
  gitSha: string | null;
  /** Branch name, or null when unknown (detached HEAD, tag build). */
  branch: string | null;
  env: BuildEnv;
}

type Env = Record<string, string | undefined>;

export function git(args: string[], cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const sha = (v: string | undefined): string | null =>
  v && /^[0-9a-f]{7,64}$/i.test(v) ? v.toLowerCase() : null;

const branchName = (v: string | undefined): string | null => {
  const b = v?.replace(/^refs\/heads\//, "");
  return b && b !== "HEAD" && BRANCH_RE.test(b) ? b : null;
};

/** Default production branches, used when the provider doesn't say which branch is production. */
function isProductionBranch(branch: string | null, env: Env, known?: string): boolean {
  if (!branch) return false;
  const configured = env.REGRESSO_PRODUCTION_BRANCH ?? known;
  return configured ? branch === configured : branch === "main" || branch === "master";
}

function readJson(path: string | undefined): Record<string, unknown> | undefined {
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

type Detected = Omit<BuildContext, "provider" | "env"> & { env: BuildEnv | null };

function vercel(env: Env): Detected {
  const e = env.VERCEL_ENV;
  return {
    gitSha: sha(env.VERCEL_GIT_COMMIT_SHA),
    branch: branchName(env.VERCEL_GIT_COMMIT_REF),
    // Custom environments (staging, qa…) are previews for deploy detection.
    env: e === "production" ? "production" : e === "development" ? "development" : "preview",
  };
}

function netlify(env: Env): Detected {
  const c = env.CONTEXT;
  return {
    gitSha: sha(env.COMMIT_REF),
    branch: branchName(env.HEAD ?? env.BRANCH),
    env: c === "production" ? "production" : c === "dev" ? "development" : "preview",
  };
}

function render(env: Env): Detected {
  return {
    gitSha: sha(env.RENDER_GIT_COMMIT),
    branch: branchName(env.RENDER_GIT_BRANCH),
    env: env.IS_PULL_REQUEST === "true" ? "preview" : "production",
  };
}

function cloudflarePages(env: Env): Detected {
  const branch = branchName(env.CF_PAGES_BRANCH);
  // Pages doesn't expose the production branch to the build.
  return {
    gitSha: sha(env.CF_PAGES_COMMIT_SHA),
    branch,
    env: isProductionBranch(branch, env) ? "production" : "preview",
  };
}

function cloudflareWorkers(env: Env): Detected {
  const branch = branchName(env.WORKERS_CI_BRANCH);
  return {
    gitSha: sha(env.WORKERS_CI_COMMIT_SHA),
    branch,
    env: isProductionBranch(branch, env) ? "production" : "preview",
  };
}

function githubActions(env: Env): Detected {
  const event = readJson(env.GITHUB_EVENT_PATH);
  const repo = event?.repository as { default_branch?: string } | undefined;
  if (env.GITHUB_EVENT_NAME?.startsWith("pull_request")) {
    // GITHUB_SHA is the merge commit on pull_request events; the PR head is what was written.
    const pr = event?.pull_request as { head?: { sha?: string } } | undefined;
    return {
      gitSha: sha(pr?.head?.sha) ?? sha(env.GITHUB_SHA),
      branch: branchName(env.GITHUB_HEAD_REF),
      env: "preview",
    };
  }
  const isTag = env.GITHUB_REF_TYPE === "tag" || env.GITHUB_REF?.startsWith("refs/tags/");
  const branch = isTag ? null : branchName(env.GITHUB_REF_NAME);
  return {
    gitSha: sha(env.GITHUB_SHA),
    branch,
    env: isTag || isProductionBranch(branch, env, repo?.default_branch) ? "production" : "preview",
  };
}

function gitlab(env: Env): Detected {
  if (env.CI_MERGE_REQUEST_IID) {
    return {
      gitSha: sha(env.CI_COMMIT_SHA),
      branch: branchName(env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ?? env.CI_COMMIT_REF_NAME),
      env: "preview",
    };
  }
  const branch = branchName(env.CI_COMMIT_BRANCH);
  return {
    gitSha: sha(env.CI_COMMIT_SHA),
    branch,
    env:
      env.CI_COMMIT_TAG || isProductionBranch(branch, env, env.CI_DEFAULT_BRANCH)
        ? "production"
        : "preview",
  };
}

const PROVIDERS: [CiProvider, (env: Env) => boolean, (env: Env) => Detected][] = [
  ["vercel", (e) => e.VERCEL === "1", vercel],
  ["netlify", (e) => e.NETLIFY === "true", netlify],
  ["render", (e) => e.RENDER === "true", render],
  ["cloudflare-pages", (e) => e.CF_PAGES === "1", cloudflarePages],
  ["cloudflare-workers", (e) => e.WORKERS_CI === "1", cloudflareWorkers],
  ["github-actions", (e) => e.GITHUB_ACTIONS === "true", githubActions],
  ["gitlab-ci", (e) => e.GITLAB_CI === "true", gitlab],
];

/** Other CI variables that carry the commit, for providers without their own reader. */
const SHA_FALLBACK_ENV = ["BITBUCKET_COMMIT", "SOURCE_VERSION", "CIRCLE_SHA1", "BUILDKITE_COMMIT"];

/**
 * Reads the commit, branch and target environment of this build from the CI provider's
 * variables, falling back to git. `REGRESSO_GIT_SHA`, `REGRESSO_BRANCH` and `REGRESSO_ENV`
 * override whatever is detected.
 */
export function detectBuildContext(
  env: Env = process.env,
  cwd: string = process.cwd(),
): BuildContext {
  const found = PROVIDERS.find(([, is]) => is(env));
  const provider = found?.[0] ?? null;
  const fromProvider: Detected = found ? found[2](env) : { gitSha: null, branch: null, env: null };

  let gitSha = sha(env.REGRESSO_GIT_SHA) ?? fromProvider.gitSha;
  if (!gitSha) {
    for (const name of SHA_FALLBACK_ENV) gitSha ??= sha(env[name]);
  }
  gitSha ??= sha(git(["rev-parse", "HEAD"], cwd));

  const branch =
    branchName(env.REGRESSO_BRANCH) ??
    fromProvider.branch ??
    branchName(git(["rev-parse", "--abbrev-ref", "HEAD"], cwd));

  const override = env.REGRESSO_ENV;
  let buildEnv: BuildEnv;
  if (override && (BUILD_ENVS as readonly string[]).includes(override)) {
    buildEnv = override as BuildEnv;
  } else if (fromProvider.env) {
    buildEnv = fromProvider.env;
  } else if (env.CI && env.CI !== "false" && env.CI !== "0") {
    buildEnv = isProductionBranch(branch, env) ? "production" : "preview";
  } else {
    buildEnv = "development"; // a build on someone's machine
  }

  return { provider, gitSha, branch, env: buildEnv };
}
