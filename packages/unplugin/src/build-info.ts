import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

function git(args: string[], cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** Repository root (`git rev-parse --show-toplevel`), or `cwd` outside a git checkout. */
export function repoRoot(cwd: string = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], cwd) ?? cwd;
}

/** CI variables that carry the commit being built, checked before asking git. */
const SHA_ENV = [
  "REGRESSO_GIT_SHA",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
  "CF_PAGES_COMMIT_SHA",
  "COMMIT_REF", // Netlify
  "CI_COMMIT_SHA", // GitLab
  "BITBUCKET_COMMIT",
  "SOURCE_VERSION", // Heroku
];

/** Full git SHA of the commit being built, or null when unknown. */
export function gitSha(cwd: string = process.cwd()): string | null {
  for (const name of SHA_ENV) {
    const v = process.env[name];
    if (v && /^[0-9a-f]{7,40}$/i.test(v)) return v.toLowerCase();
  }
  return git(["rev-parse", "HEAD"], cwd) ?? null;
}

/**
 * New build id: short SHA plus a nonce, because one commit can be built more than once (different
 * env, a rebuild). Matches the protocol's `bid` format.
 */
export function makeBuildId(sha: string | null): string {
  return `${sha ? sha.slice(0, 12) : "nogit"}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}
