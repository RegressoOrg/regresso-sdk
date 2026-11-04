import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectBuildContext } from "../src/ci.js";

const SHA = "a03fc282419bfd1453dfccc9d2f4e20a77d8e543";
const HEAD = "b".repeat(40);
// A directory outside any git checkout, so the git fallback finds nothing.
const noGit = await mkdtemp(join(tmpdir(), "regresso-ci-"));
const detect = (env: Record<string, string>) => detectBuildContext(env, noGit);

describe("detectBuildContext", () => {
  it.each([
    [
      "Vercel production",
      {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: SHA,
        VERCEL_GIT_COMMIT_REF: "main",
      },
      { provider: "vercel", gitSha: SHA, branch: "main", env: "production" },
    ],
    [
      "Vercel preview",
      {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: SHA,
        VERCEL_GIT_COMMIT_REF: "feat/x",
      },
      { provider: "vercel", gitSha: SHA, branch: "feat/x", env: "preview" },
    ],
    [
      "Vercel custom environment",
      { VERCEL: "1", VERCEL_ENV: "staging", VERCEL_GIT_COMMIT_SHA: SHA },
      { provider: "vercel", gitSha: SHA, branch: null, env: "preview" },
    ],
    [
      "Netlify deploy preview",
      {
        NETLIFY: "true",
        CONTEXT: "deploy-preview",
        COMMIT_REF: SHA,
        HEAD: "fix-1",
        BRANCH: "pull/1/head",
      },
      { provider: "netlify", gitSha: SHA, branch: "fix-1", env: "preview" },
    ],
    [
      "Netlify production",
      { NETLIFY: "true", CONTEXT: "production", COMMIT_REF: SHA, HEAD: "main" },
      { provider: "netlify", gitSha: SHA, branch: "main", env: "production" },
    ],
    [
      "Render",
      {
        RENDER: "true",
        RENDER_GIT_COMMIT: SHA,
        RENDER_GIT_BRANCH: "main",
        IS_PULL_REQUEST: "false",
      },
      { provider: "render", gitSha: SHA, branch: "main", env: "production" },
    ],
    [
      "Render pull request preview",
      { RENDER: "true", RENDER_GIT_COMMIT: SHA, RENDER_GIT_BRANCH: "pr", IS_PULL_REQUEST: "true" },
      { provider: "render", gitSha: SHA, branch: "pr", env: "preview" },
    ],
    [
      "Cloudflare Pages main",
      { CF_PAGES: "1", CF_PAGES_COMMIT_SHA: SHA, CF_PAGES_BRANCH: "main" },
      { provider: "cloudflare-pages", gitSha: SHA, branch: "main", env: "production" },
    ],
    [
      "Cloudflare Pages branch, custom production branch",
      {
        CF_PAGES: "1",
        CF_PAGES_COMMIT_SHA: SHA,
        CF_PAGES_BRANCH: "main",
        REGRESSO_PRODUCTION_BRANCH: "live",
      },
      { provider: "cloudflare-pages", gitSha: SHA, branch: "main", env: "preview" },
    ],
    [
      "GitLab merge request",
      {
        GITLAB_CI: "true",
        CI_COMMIT_SHA: SHA,
        CI_MERGE_REQUEST_IID: "7",
        CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: "mr",
      },
      { provider: "gitlab-ci", gitSha: SHA, branch: "mr", env: "preview" },
    ],
    [
      "GitLab default branch",
      {
        GITLAB_CI: "true",
        CI_COMMIT_SHA: SHA,
        CI_COMMIT_BRANCH: "trunk",
        CI_DEFAULT_BRANCH: "trunk",
      },
      { provider: "gitlab-ci", gitSha: SHA, branch: "trunk", env: "production" },
    ],
    [
      "GitHub Actions push to main (no event file)",
      {
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "push",
        GITHUB_SHA: SHA,
        GITHUB_REF_NAME: "main",
        GITHUB_REF: "refs/heads/main",
      },
      { provider: "github-actions", gitSha: SHA, branch: "main", env: "production" },
    ],
    [
      "GitHub Actions tag",
      {
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "push",
        GITHUB_SHA: SHA,
        GITHUB_REF_NAME: "v1.2.0",
        GITHUB_REF_TYPE: "tag",
      },
      { provider: "github-actions", gitSha: SHA, branch: null, env: "production" },
    ],
    [
      "unknown CI on main",
      { CI: "true", REGRESSO_GIT_SHA: SHA, REGRESSO_BRANCH: "main" },
      { provider: null, gitSha: SHA, branch: "main", env: "production" },
    ],
    ["local build", {}, { provider: null, gitSha: null, branch: null, env: "development" }],
  ])("%s", (_label, env, expected) => {
    expect(detect(env as Record<string, string>)).toEqual(expected);
  });

  it("uses the PR head on GitHub pull_request events, not the merge commit", async () => {
    const event = join(noGit, "event.json");
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: HEAD } } }));
    expect(
      detect({
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: event,
        GITHUB_SHA: SHA,
        GITHUB_HEAD_REF: "feature",
      }),
    ).toEqual({ provider: "github-actions", gitSha: HEAD, branch: "feature", env: "preview" });
  });

  it("reads GitHub's default branch from the event payload", async () => {
    const event = join(noGit, "push.json");
    await writeFile(event, JSON.stringify({ repository: { default_branch: "develop" } }));
    const base = {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      GITHUB_EVENT_PATH: event,
      GITHUB_SHA: SHA,
    };
    expect(detect({ ...base, GITHUB_REF_NAME: "develop" }).env).toBe("production");
    expect(detect({ ...base, GITHUB_REF_NAME: "main" }).env).toBe("preview");
  });

  it("lets REGRESSO_* variables override detection", () => {
    expect(
      detect({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: SHA,
        REGRESSO_GIT_SHA: HEAD.toUpperCase(),
        REGRESSO_BRANCH: "release",
        REGRESSO_ENV: "production",
      }),
    ).toEqual({ provider: "vercel", gitSha: HEAD, branch: "release", env: "production" });
  });

  it("ignores malformed values", () => {
    const r = detect({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "not-a-sha", REGRESSO_ENV: "staging" });
    expect(r.gitSha).toBeNull();
    expect(r.env).toBe("preview");
  });
});
