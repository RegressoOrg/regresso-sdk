// Reports what @regresso/browser adds to a page: dist/index.js bundled with its
// dependencies (web-vitals/attribution, the parts of @regresso/protocol it uses), minified.
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "esbuild";

async function measure(label, external) {
  const out = await build({
    entryPoints: [new URL("../dist/index.js", import.meta.url).pathname],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    write: false,
    external,
    logLevel: "silent",
  });
  const code = out.outputFiles[0].contents;
  return {
    bundle: label,
    min: code.byteLength,
    gzip: gzipSync(code, { level: 9 }).byteLength,
    brotli: brotliCompressSync(code).byteLength,
  };
}

const rows = [
  await measure("total (with web-vitals/attribution)", []),
  await measure("Regresso code only (web-vitals external)", ["web-vitals", "web-vitals/*"]),
];
console.table(rows);
if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
