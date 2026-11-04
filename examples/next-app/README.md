# next-app

Fixture for the Regresso SDK: a small Next.js 16 App Router shop with server components (layout, pages,
`ProductCard`, `ProductGallery`, `Reviews`, header and footer) and client components (`AddToCart`,
`PromoBanner`), and a page in a route group (`app/(info)/about`). `app/api/beacon` stands in for the ingest
Worker: it validates each beacon with `@regresso/protocol` and logs it.

It uses `@regresso/next` the way the [quickstart](../../packages/next#readme) describes: `withRegresso` in
`next.config.ts`, `initRegresso` in `instrumentation-client.ts`, builds with `--webpack`.

```bash
cp examples/next-app/.env.example examples/next-app/.env.local   # then fill in a dev project's key
```

```bash
pnpm build && pnpm --filter next-app start
```

[`.env.example`](.env.example) points beacons at the development ingest. Set `REGRESSO_INGEST_URL=/api/beacon`
instead to keep everything local: beacons are then validated and printed by this app's server. `debug` is on
outside production builds (and with `NEXT_PUBLIC_REGRESSO_DEBUG=1`), so the browser console shows each beacon.

Deliberate regressions, switched on at build time:

```bash
NEXT_PUBLIC_REGRESS=inp,cls,lcp pnpm --filter next-app build
```

- `inp`: `AddToCart` blocks the main thread for 250 ms on click.
- `cls`: `PromoBanner` is inserted above the page 600 ms after load.
- `lcp`: `ProductGallery`'s hero image is lazy-loaded at low priority.

`REGRESSO_DISABLE=1` builds without tagging.

## Spike 1

`pnpm spike` (after `pnpm build` at the repo root) builds the app several times and writes
[`spike-results/report.md`](spike-results/report.md): server components tagged, `component_id` stability
across builds, HTML cost, and an end-to-end beacon from headless Chromium (when Playwright is installed).
