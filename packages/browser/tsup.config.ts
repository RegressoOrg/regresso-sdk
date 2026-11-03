import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  sourcemap: true,
  clean: true,
  dts: false,
  // Dependencies stay external: the app's bundler dedupes and tree-shakes them.
});
