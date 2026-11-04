// Pack-and-install test: packs every publishable package with `pnpm pack` (which rewrites
// `workspace:` ranges the way `pnpm publish` does), installs the tarballs with npm into a fresh
// Next.js app outside this workspace, builds it with `next build --webpack` against a local stand-in
// for the builds API, and checks that:
//   - the tarballs contain no `workspace:` ranges and only dist/ + README + LICENSE + package.json,
//   - components are tagged in the server-rendered HTML,
//   - the build id and public key reach the client bundle,
//   - the build upload arrives gzip-encoded, authorised and valid, with the app's routes.
//
// Usage: pnpm build && pnpm pack:test   (needs network access to the npm registry for next/react)
// Pass --keep to keep the temp directory.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repo = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["protocol", "browser", "unplugin", "next"];
const tmp = mkdtempSync(join(tmpdir(), "regresso-pack-"));
const tarballs = join(tmp, "tarballs");
const app = join(tmp, "app");
const log = (...a) => console.log("[pack-test]", ...a);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// 1. Pack.
mkdirSync(tarballs);
const files = {};
for (const name of PACKAGES) {
  const out = run("pnpm", ["pack", "--pack-destination", tarballs], {
    cwd: join(repo, "packages", name),
  });
  const file = out.trim().split("\n").pop();
  files[`@regresso/${name}`] = file;
  const listing = run("tar", ["-tzf", file]).trim().split("\n");
  const unexpected = listing.filter(
    (f) => !/^package\/(dist\/.+|README\.md|LICENSE|package\.json)$/.test(f),
  );
  check(
    unexpected.length === 0,
    `${name}: tarball holds only dist, README, LICENSE (${listing.length} files)`,
  );
  const manifest = run("tar", ["-xzOf", file, "package/package.json"]);
  check(!manifest.includes("workspace:"), `${name}: no workspace: ranges`);
}

// 2. A fresh Next.js app that uses the packages the way the README says.
const nextVersion = JSON.parse(readFileSync(join(repo, "packages/next/package.json"), "utf8"))
  .devDependencies.next;
const write = (path, content) => {
  mkdirSync(join(app, path, ".."), { recursive: true });
  writeFileSync(join(app, path), content);
};
const deps = Object.fromEntries(Object.entries(files).map(([n, f]) => [n, `file:${f}`]));
write(
  "package.json",
  JSON.stringify(
    {
      name: "regresso-pack-test",
      private: true,
      type: "module",
      dependencies: { ...deps, next: nextVersion, react: "^19", "react-dom": "^19" },
      devDependencies: { typescript: "^5", "@types/react": "^19", "@types/node": "^22" },
      // Make the packages' dependencies on each other resolve to these tarballs, not the registry.
      overrides: deps,
    },
    null,
    2,
  ),
);
write(
  "next.config.ts",
  `import { withRegresso } from "@regresso/next";\nexport default withRegresso({});\n`,
);
write(
  "instrumentation-client.ts",
  `import { initRegresso } from "@regresso/next/client";\ninitRegresso({ sampleRate: 1, debug: true });\n`,
);
write(
  "app/layout.tsx",
  `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`,
);
write(
  "app/page.tsx",
  `import { Counter } from "../components/counter";\nexport default function Home() {\n  return <main><h1>Pack test</h1><Counter /></main>;\n}\n`,
);
write(
  "app/(marketing)/pricing/page.tsx",
  `export default function Pricing() {\n  return <section>Pricing</section>;\n}\n`,
);
write(
  "app/posts/[slug]/page.tsx",
  `export default async function Post({ params }: { params: Promise<{ slug: string }> }) {\n  const { slug } = await params;\n  return <article>{slug}</article>;\n}\n`,
);
write(
  "components/counter.tsx",
  `"use client";\nimport { useState } from "react";\nexport function Counter() {\n  const [n, setN] = useState(0);\n  return <button type="button" onClick={() => setN(n + 1)}>{n}</button>;\n}\n`,
);
write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "es2022"],
      strict: true,
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      isolatedModules: true,
      skipLibCheck: true,
      esModuleInterop: true,
      plugins: [{ name: "next" }],
    },
    include: ["**/*.ts", "**/*.tsx", "next-env.d.ts"],
  }),
);

log(`installing into ${app}`);
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: app });
for (const name of PACKAGES) {
  const installed = JSON.parse(
    readFileSync(join(app, "node_modules/@regresso", name, "package.json"), "utf8"),
  );
  check(
    Boolean(installed.version),
    `@regresso/${name}@${installed.version} installed from the tarball`,
  );
}

// 3. Build against a stand-in API.
const received = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ buildId: "echo", projectId: "prj_pack_test" }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${server.address().port}`;

log("next build --webpack");
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_REGRESSO_KEY: "pk_test_packtest01",
  REGRESSO_BUILD_TOKEN: "sk_test_packtest01",
  REGRESSO_API_URL: apiUrl,
  REGRESSO_INGEST_URL: "https://ingest.example.com",
  REGRESSO_ENV: "preview",
};
delete env.REGRESSO_BUILD_ID;
// Async, so the stand-in server keeps answering while next builds.
const buildOutput = await new Promise((resolve, reject) => {
  import("node:child_process").then(({ execFile }) =>
    execFile(
      join(app, "node_modules/.bin/next"),
      ["build", "--webpack"],
      { cwd: app, env },
      (err, stdout, stderr) =>
        err ? reject(new Error(`${stdout}\n${stderr}`)) : resolve(stdout + stderr),
    ),
  );
});
server.close();
console.log(
  buildOutput
    .split("\n")
    .filter((l) => l.includes("regresso"))
    .join("\n"),
);

// 4. Checks.
const html = readFileSync(join(app, ".next/server/app/index.html"), "utf8");
check(/<main data-cwv="[0-9a-z]{8}"/.test(html), "server component tagged in HTML");
check(/<button data-cwv="[0-9a-z]{8}"/.test(html), "client component tagged in HTML");

const manifest = JSON.parse(readFileSync(join(app, ".next/regresso/manifest.json"), "utf8"));
const chunks = readdirSync(join(app, ".next/static/chunks"), { recursive: true })
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(app, ".next/static/chunks", f), "utf8"))
  .join("\n");
check(chunks.includes(manifest.buildId), "build id injected into the client bundle");
check(chunks.includes("pk_test_packtest01"), "public key injected into the client bundle");
check(
  chunks.includes("https://ingest.example.com"),
  "REGRESSO_INGEST_URL injected into the client bundle",
);

check(received.length === 1, `one upload received (${received.length})`);
const upload = received[0];
if (upload) {
  check(upload.url === "/v1/builds", "POST /v1/builds");
  check(upload.headers.authorization === "Bearer sk_test_packtest01", "bearer token");
  check(upload.headers["content-encoding"] === "gzip", "gzip-encoded");
  const body = JSON.parse(gunzipSync(upload.body).toString());
  const { validateBuildUpload } = await import(
    join(app, "node_modules/@regresso/protocol/dist/index.js")
  );
  check(validateBuildUpload(body).ok, "payload is a valid BuildUploadV1");
  check(body.framework === "next" && body.env === "preview", "framework next, env preview");
  check(
    JSON.stringify(body.routes) === JSON.stringify(["/", "/posts/[slug]", "/pricing"]),
    `routes ${JSON.stringify(body.routes)}`,
  );
  check(
    ["Counter", "Home", "Post", "Pricing", "RootLayout"].every((n) =>
      body.components.some((c) => c.name === n),
    ),
    `components ${body.components.map((c) => c.name).join(", ")}`,
  );
}

if (!process.argv.includes("--keep")) rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.error(`[pack-test] ${failures.length} check(s) failed`);
  process.exit(1);
}
log("all checks passed");
