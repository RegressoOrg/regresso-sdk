import { randomBytes } from "node:crypto";
import { detectBuildContext, git } from "./ci.js";

/** Repository root (`git rev-parse --show-toplevel`), or `cwd` outside a git checkout. */
export function repoRoot(cwd: string = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], cwd) ?? cwd;
}

/** Full git SHA of the commit being built, or null when unknown. See {@link detectBuildContext}. */
export function gitSha(cwd: string = process.cwd()): string | null {
  return detectBuildContext(process.env, cwd).gitSha;
}

/**
 * New build id: short SHA plus a nonce, because one commit can be built more than once (different
 * env, a rebuild). Matches the protocol's `bid` format.
 */
export function makeBuildId(sha: string | null): string {
  return `${sha ? sha.slice(0, 12) : "nogit"}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}
