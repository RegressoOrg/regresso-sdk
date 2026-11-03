// Spike 1: tagging. Builds this app several times and measures
//   1. that server components are tagged,
//   2. that component_id is identical across builds while content_hash follows file edits,
//   3. what data-cwv costs in HTML bytes,
//   4. (if Playwright is available) that a real page view produces a valid, attributed beacon.
// Writes spike-results/report.json and spike-results/report.md.
//
// Usage: pnpm build (packages) && pnpm --filter next-app spike

import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const app = fileURLToPath(new URL("..", import.meta.url));
const out = join(app, "spike-results");
const next = join(app, "node_modules/.bin/next");
const PAGES = ["/", "/products/espresso-machine"];
const EDITED = "components/add-to-cart.tsx";
const PORT = 3199;

mkdirSync(out, { recursive: true });
const baseEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
delete baseEnv.REGRESSO_BUILD_ID; // each build makes its own
delete baseEnv.REGRESSO_DISABLE;
const log = (...a) => console.log("[spike]", ...a);

function build(label, { clean = true, env = {} } = {}) {
  if (clean) rmSync(join(app, ".next"), { recursive: true, force: true });
  log(`build ${label}${clean ? " (clean)" : " (warm cache)"}`);
  const started = Date.now();
  execFileSync(next, ["build", "--webpack"], {
    cwd: app,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...baseEnv, ...env },
  });
  const ms = Date.now() - started;
  const path = join(app, ".next/regresso/manifest.json");
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  if (manifest)
    writeFileSync(join(out, `manifest-${label}.json`), JSON.stringify(manifest, null, 2));
  return { label, ms, manifest };
}

async function serve(env = {}) {
  // A leftover server on the port would silently answer for the wrong build.
  const busy = await fetch(`http://localhost:${PORT}/`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`port ${PORT} is already in use`);
  const child = spawn(next, ["start", "-p", String(PORT)], {
    cwd: app,
    detached: true, // own process group, so stop() also ends next-server's children
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...baseEnv, ...env },
  });
  child.stdout.on("data", () => {});
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return child;
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error("server did not start");
}

async function stop(child) {
  const exited = new Promise((r) => child.once("exit", r));
  process.kill(-child.pid, "SIGTERM");
  await exited;
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://localhost:${PORT}/`).then(
      () => true,
      () => false,
    );
    if (!up) return;
    await sleep(100);
  }
  throw new Error("server did not stop");
}

async function fetchPages() {
  const pages = {};
  for (const p of PAGES) {
    const html = await (await fetch(`http://localhost:${PORT}${p}`)).text();
    const attrs = html.match(/ data-cwv="[0-9a-z]+"/g) ?? [];
    // The RSC payload inlined in <script> tags repeats every prop, including data-cwv.
    const flight = html.match(/\\"data-cwv\\":\\"[0-9a-z]+\\"/g) ?? [];
    pages[p] = {
      html,
      bytes: Buffer.byteLength(html),
      gzip: gzipSync(html, { level: 6 }).byteLength,
      attributes: attrs.length,
      attributeBytes: attrs.join("").length,
      flightCopies: flight.length,
      flightBytes: flight.join("").length,
    };
  }
  return pages;
}

const strip = (pages) =>
  Object.fromEntries(Object.entries(pages).map(([k, { html, ...rest }]) => [k, rest]));

function compareManifests(a, b) {
  const byId = (m) => new Map(m.components.map((c) => [c.id, c]));
  const A = byId(a);
  const B = byId(b);
  const sameIds = A.size === B.size && [...A.keys()].every((id) => B.has(id));
  const changed = [...A.values()]
    .filter((c) => B.get(c.id)?.content_hash !== c.content_hash)
    .map((c) => `${c.name} (${c.file})`);
  const sameKeys = [...A.values()].every((c) => {
    const o = B.get(c.id);
    return o && o.name === c.name && o.file === c.file;
  });
  return {
    sameIds,
    sameKeys,
    idCount: A.size,
    contentHashChanged: changed,
    buildIds: [a.build_id, b.build_id],
  };
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    return null;
  }
}

async function e2e(manifest) {
  const pw = loadPlaywright();
  if (!pw) {
    log("Playwright not found; skipping the beacon check");
    return { skipped: true };
  }
  const beaconLog = join(out, "beacons.jsonl");
  rmSync(beaconLog, { force: true });
  appendFileSync(beaconLog, "");
  const server = await serve({ BEACON_LOG: beaconLog });
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/products/espresso-machine?utm_source=test#reviews`);
    await page.waitForTimeout(1200); // let the promo banner shift the layout
    await page.click("button");
    // web-vitals processes interactions in an idle callback (up to 1 s) and can drop one that
    // happens just before the page is hidden. See the PR notes.
    await page.waitForTimeout(2500);
    await page.goto("about:blank"); // pagehide + visibilitychange:hidden → beacon
    for (let i = 0; i < 25 && !readFileSync(beaconLog, "utf8").trim(); i++) await sleep(200);
  } finally {
    await browser.close();
    await stop(server);
  }
  const beacons = readFileSync(beaconLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const name = (id) => manifest.components.find((c) => c.id === id)?.name ?? null;
  const b = beacons.at(-1);
  return {
    beacons: beacons.length,
    beacon: b,
    attributed: b && {
      lcp: name(b.m.lcp?.c),
      inp: name(b.m.inp?.c),
      cls: name(b.m.cls?.c),
      clsSources: (b.m.cls?.src ?? []).map(name),
    },
    pathnameOnly: b ? !JSON.stringify(b).includes("utm_source") : null,
  };
}

// ---------------------------------------------------------------------------------------------

const report = { date: new Date().toISOString(), node: process.version };

if (process.env.SPIKE_ONLY === "e2e") {
  const e = build("e2e", { env: { NEXT_PUBLIC_REGRESS: "inp,cls" } });
  console.log(JSON.stringify(await e2e(e.manifest), null, 2));
  process.exit(0);
}

// Baseline: same app, tagging off.
build("untagged", { env: { REGRESSO_DISABLE: "1" } });
let server = await serve();
const untagged = await fetchPages();
await stop(server);

// Build A (clean): tagged.
const a = build("a");
server = await serve();
const tagged = await fetchPages();
await stop(server);

// Server components: files without "use client" whose id shows up in the HTML.
const html = Object.values(tagged)
  .map((p) => p.html)
  .join("\n");
const isClient = (file) =>
  /^\s*["']use client["']/.test(readFileSync(join(app, "..", "..", file), "utf8"));
report.serverComponents = a.manifest.components
  .filter((c) => !isClient(c.file))
  .map((c) => ({
    name: c.name,
    file: c.file,
    id: c.id,
    inHtml: html.includes(`data-cwv="${c.id}"`),
  }));
report.clientComponents = a.manifest.components
  .filter((c) => isClient(c.file))
  .map((c) => ({
    name: c.name,
    file: c.file,
    id: c.id,
    inHtml: html.includes(`data-cwv="${c.id}"`),
  }));

// Build B (clean again, no source change): ids and hashes must match A.
const b = build("b");
report.stability = { aVsB: compareManifests(a.manifest, b.manifest) };

// Build C (warm webpack cache, one file edited): ids match, only that file's hashes change.
const editedPath = join(app, EDITED);
const original = readFileSync(editedPath, "utf8");
try {
  writeFileSync(editedPath, original.replace("Add to cart", "Add to basket"));
  const c = build("c-edited", { clean: false });
  report.stability.bVsC = { edited: EDITED, ...compareManifests(b.manifest, c.manifest) };
} finally {
  writeFileSync(editedPath, original);
}
report.buildTimesMs = { a: a.ms, b: b.ms };

report.html = PAGES.map((p) => {
  const t = tagged[p];
  const u = untagged[p];
  return {
    page: p,
    untaggedBytes: u.bytes,
    taggedBytes: t.bytes,
    addedBytes: t.bytes - u.bytes,
    addedPct: +(((t.bytes - u.bytes) / u.bytes) * 100).toFixed(2),
    untaggedGzip: u.gzip,
    taggedGzip: t.gzip,
    addedGzipBytes: t.gzip - u.gzip,
    addedGzipPct: +(((t.gzip - u.gzip) / u.gzip) * 100).toFixed(2),
    attributes: t.attributes,
    attributeBytes: t.attributeBytes,
    flightCopies: t.flightCopies,
    flightBytes: t.flightBytes,
  };
});
report.pages = { untagged: strip(untagged), tagged: strip(tagged) };

// Beacon end to end, on a build with the INP and CLS regressions switched on.
const e = build("e2e", { env: { NEXT_PUBLIC_REGRESS: "inp,cls" } });
report.e2e = await e2e(e.manifest);

writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

const yes = (x) => (x ? "yes" : "**no**");
const md = [
  "# Spike 1 results: tagging",
  "",
  `Generated by \`pnpm spike\` on ${report.date.slice(0, 10)} (Node ${report.node}, Next.js webpack build).`,
  "",
  "## Server components are tagged",
  "",
  "| Component | File | id | In HTML |",
  "|---|---|---|---|",
  ...report.serverComponents.map(
    (c) => `| ${c.name} | \`${c.file}\` | \`${c.id}\` | ${yes(c.inHtml)} |`,
  ),
  "",
  "Client components:",
  "",
  "| Component | File | id | In HTML |",
  "|---|---|---|---|",
  ...report.clientComponents.map(
    (c) => `| ${c.name} | \`${c.file}\` | \`${c.id}\` | ${yes(c.inHtml)} |`,
  ),
  "",
  "## component_id stability",
  "",
  "| Comparison | Build ids | Same ids | Changed content_hash |",
  "|---|---|---|---|",
  `| A vs B, two clean builds, no change | \`${report.stability.aVsB.buildIds.join("` / `")}\` | ${yes(report.stability.aVsB.sameIds && report.stability.aVsB.sameKeys)} (${report.stability.aVsB.idCount}) | ${report.stability.aVsB.contentHashChanged.join(", ") || "none"} |`,
  `| B vs C, warm cache, \`${EDITED}\` edited | \`${report.stability.bVsC.buildIds.join("` / `")}\` | ${yes(report.stability.bVsC.sameIds && report.stability.bVsC.sameKeys)} (${report.stability.bVsC.idCount}) | ${report.stability.bVsC.contentHashChanged.join(", ") || "none"} |`,
  "",
  "## HTML cost",
  "",
  "| Page | Untagged | Tagged | Added | Added (gzip) | Attributes | Copies in RSC payload |",
  "|---|---|---|---|---|---|---|",
  ...report.html.map(
    (h) =>
      `| \`${h.page}\` | ${h.untaggedBytes} B | ${h.taggedBytes} B | +${h.addedBytes} B (${h.addedPct}%) | +${h.addedGzipBytes} B (${h.addedGzipPct}%) | ${h.attributes} (${h.attributeBytes} B) | ${h.flightCopies} (${h.flightBytes} B) |`,
  ),
  "",
  "## Beacon end to end",
  "",
  report.e2e.skipped
    ? "Skipped: Playwright not installed."
    : [
        `Beacons received and validated by \`@regresso/protocol\`: ${report.e2e.beacons}. Query string and fragment absent: ${yes(report.e2e.pathnameOnly)}.`,
        "",
        `Attribution: LCP → ${report.e2e.attributed?.lcp}, INP → ${report.e2e.attributed?.inp}, CLS → ${report.e2e.attributed?.cls} (sources: ${report.e2e.attributed?.clsSources.join(", ") || "none"}).`,
        "",
        "```json",
        JSON.stringify(report.e2e.beacon, null, 2),
        "```",
      ].join("\n"),
  "",
].join("\n");
writeFileSync(join(out, "report.md"), md);
console.log(`\n${md}`);
