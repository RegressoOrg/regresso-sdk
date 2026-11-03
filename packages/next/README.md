# @regresso/next

Regresso for Next.js (App Router and Pages Router, webpack builds).

```ts
// next.config.ts
import { withRegresso } from "@regresso/next";

export default withRegresso({
  // your config
});
```

```ts
// instrumentation-client.ts
import { initRegresso } from "@regresso/next/client";

initRegresso({ pk: "pk_…", endpoint: "https://…/b" });
```

`withRegresso(config, options?)`:

- adds `@regresso/unplugin` as a `pre` loader in the client, server and edge compilations, so every
  component in the project directory, server components included, gets `data-cwv` on its outermost element;
- writes `<distDir>/regresso/manifest.json` on `next build` (pass `manifestInDev: true` for `next dev`);
- injects the build id as the `__REGRESSO_BUILD_ID__` define, which `@regresso/next/client` reads.

The build id is created once and stored in `process.env.REGRESSO_BUILD_ID`, so Next's build workers agree
on it; set that variable yourself to choose it. It accepts a config object or a config function.

Options: `enabled` (default true), `root`, `include` (default: `.jsx`/`.tsx`/`.js` files inside the
project directory, so linked workspace packages are not tagged), `exclude`, `manifestInDev`,
`onManifest`.

Turbopack is not supported yet. Next.js 16 builds with Turbopack by default, so build with
`next build --webpack` (and `next dev --webpack`). Without webpack, `initRegresso` warns and does nothing,
because beacons without a build id can't be compared across deploys.
