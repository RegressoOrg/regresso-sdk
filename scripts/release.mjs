#!/usr/bin/env node
// Cuts a release from a clean, up-to-date main: asks for the bump, runs the checks, versions the packages,
// then pushes a commit and a vX.Y.Z tag. The tag triggers .github/workflows/release.yml, which publishes to
// npm from CI, because provenance can't be generated on a laptop.
//
// Usage: pnpm release [--dry-run]
// --dry-run asks the same questions and shows the resulting version, skips the checks, and changes nothing.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const dryRun = process.argv.includes("--dry-run");
const BUMPS = ["major", "minor", "patch"];
const CHANGESET_DIR = ".changeset";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function run(command, args) {
  const { status } = spawnSync(command, args, { stdio: "inherit" });
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function fail(message) {
  console.error(`\nRelease stopped: ${message}`);
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const packages = readdirSync("packages").map((dir) =>
  readJson(join("packages", dir, "package.json")),
);
const packageNames = packages.map((pkg) => pkg.name);
const currentVersion = () => readJson(join("packages", "browser", "package.json")).version;

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function checkGitState() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`you're on "${branch}". Switch to main.`);
  if (git("status", "--porcelain")) fail("the working tree has uncommitted changes.");

  git("fetch", "--quiet", "--tags", "origin", "main");
  const [ahead, behind] = git("rev-list", "--left-right", "--count", "HEAD...origin/main")
    .split(/\s+/)
    .map(Number);
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main. Run git pull.`);
  if (ahead > 0) fail(`main has ${ahead} unpushed commit(s). Push or drop them first.`);
}

// Publishing needs a public repo (npm rejects provenance from private ones) and the NPM_TOKEN secret.
// Without this check the tag would be pushed and only then fail in CI.
function checkPublishRequirements() {
  const problems = [];
  try {
    const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: "pipe" });
    const { visibility } = JSON.parse(gh("repo", "view", "--json", "visibility"));
    if (visibility !== "PUBLIC")
      problems.push(
        `the repo is ${visibility.toLowerCase()}, and npm rejects provenance from private repos`,
      );
    const secrets = JSON.parse(gh("secret", "list", "--json", "name"));
    if (!secrets.some(({ name }) => name === "NPM_TOKEN"))
      problems.push("the NPM_TOKEN repo secret is missing");
  } catch {
    problems.push("could not check the repo with gh (is it installed and logged in?)");
  }
  if (problems.length === 0) return;
  if (!dryRun) fail(problems.join("; "));
  for (const problem of problems)
    console.log(`Warning: a real release would stop here: ${problem}.`);
}

function pendingChangesets() {
  return readdirSync(CHANGESET_DIR).filter((file) => file.endsWith(".md") && file !== "README.md");
}

function highestPendingBump(files) {
  const text = files.map((file) => readFileSync(join(CHANGESET_DIR, file), "utf8")).join("\n");
  return BUMPS.find((bump) => new RegExp(`:\\s*["']?${bump}["']?\\s*$`, "m").test(text));
}

function writeReleaseChangeset(bump, note) {
  const path = join(CHANGESET_DIR, `release-${Date.now()}.md`);
  const header = packageNames.map((name) => `"${name}": ${bump}`).join("\n");
  writeFileSync(path, `---\n${header}\n---\n\n${note}\n`);
}

// The tree was verified clean before versioning, so this only discards what the release wrote.
function discardReleaseChanges() {
  git("restore", "--staged", "--worktree", ".");
  git("clean", "-fdq");
}

const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : value.trim();
}

async function askBump(version) {
  console.log(`\nCurrent version: ${version}`);
  BUMPS.forEach((bump, index) => {
    console.log(`  ${index + 1}) ${bump.padEnd(5)}  ${bumpVersion(version, bump)}`);
  });
  console.log("While on 0.x, a breaking change is a minor bump and anything else is a patch.");
  const answer = (await ask("Version bump (major, minor, patch): ")).toLowerCase();
  const bump = BUMPS.find((name, index) => answer === name || answer === String(index + 1));
  if (!bump) fail(`"${answer}" isn't major, minor or patch.`);
  return bump;
}

async function main() {
  if (!existsSync(CHANGESET_DIR)) fail("run this from the root of regresso-sdk.");
  checkGitState();
  checkPublishRequirements();

  const pending = pendingChangesets();
  if (pending.length > 0) {
    console.log(
      `\nPending changesets, included in this release's changelog: ${pending.join(", ")}`,
    );
  }

  const bump = await askBump(currentVersion());
  const pendingBump = highestPendingBump(pending);
  if (pendingBump && BUMPS.indexOf(pendingBump) < BUMPS.indexOf(bump)) {
    console.log(
      `A pending changeset asks for a ${pendingBump} bump, so that's what will apply instead of ${bump}.`,
    );
  }
  const note =
    (await ask("One-line changelog note (Enter to skip): ")) || `Release (${bump} bump).`;

  if (!dryRun) {
    for (const script of ["lint", "build", "typecheck", "test", "pack:test"]) run("pnpm", [script]);
    if (git("status", "--porcelain"))
      fail("the checks changed tracked or untracked files. Nothing was released.");
  }

  try {
    writeReleaseChangeset(bump, note);
    run("pnpm", ["version-packages"]);
    const version = currentVersion();
    const tag = `v${version}`;
    if (git("tag", "--list", tag)) throw new Error(`tag ${tag} already exists`);

    if (dryRun) {
      console.log(`\nDry run: this would release ${tag}. Discarding the changes.`);
      discardReleaseChanges();
      return;
    }

    const confirm = await ask(`\nCommit, tag and push ${tag}? This publishes to npm. [y/N] `);
    if (confirm.toLowerCase() !== "y") {
      console.log("Cancelled. Discarding the changes.");
      discardReleaseChanges();
      return;
    }

    git("add", "-A");
    git("commit", "-m", `Release ${tag}`);
    git("tag", "-a", tag, "-m", tag);
    try {
      run("git", ["push", "--atomic", "origin", "main", tag]);
    } catch (error) {
      git("tag", "-d", tag);
      git("reset", "--hard", "HEAD~1");
      throw error;
    }
    console.log(
      `\nPushed ${tag}. CI publishes it to npm: https://github.com/RegressoOrg/regresso-sdk/actions/workflows/release.yml`,
    );
  } catch (error) {
    if (git("status", "--porcelain")) discardReleaseChanges();
    fail(error.message);
  }
}

main()
  .catch((error) => fail(error.message))
  .finally(() => rl.close());
