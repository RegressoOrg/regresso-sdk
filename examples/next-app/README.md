# next-app

Fixture for the Regresso SDK: a small Next.js 16 App Router shop with server components (layout, pages,
`ProductCard`, `ProductGallery`, `Reviews`, header and footer) and client components (`AddToCart`,
`PromoBanner`). `app/api/beacon` stands in for the ingest Worker: it validates each beacon with
`@regresso/protocol` and logs it.

```bash
pnpm --filter next-app build && pnpm --filter next-app start
```

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
