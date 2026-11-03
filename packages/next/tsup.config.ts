import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "node",
    target: "node22",
    sourcemap: true,
    dts: false,
  },
  {
    // Browser entry: leave process.env.NODE_ENV and __REGRESSO_BUILD_ID__ for the app's bundler.
    entry: ["src/client.ts"],
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    dts: false,
  },
]);
