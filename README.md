# regresso-sdk

Client and build-time packages for Regresso: Core Web Vitals regression alerts that name the component and PR
that caused them.

| Package | What it does |
|---|---|
| [`@regresso/protocol`](packages/protocol) | Beacon schema v1: types, validator and codec shared with the ingest Worker. No dependencies. |
| [`@regresso/browser`](packages/browser) | Browser client: web-vitals attribution → nearest `data-cwv` → one beacon per page view. 6.9 KB gzip. |
| [`@regresso/unplugin`](packages/unplugin) | Build plugin: tags components with `data-cwv`, writes the build manifest. |
| [`@regresso/next`](packages/next) | `withRegresso(nextConfig)` and `initRegresso()` for `instrumentation-client.ts`. |
| [`examples/next-app`](examples/next-app) | App Router fixture with server and client components and switchable regressions. |

## Development

Node 22 and pnpm 10.

```bash
pnpm install
```

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint
```

```bash
pnpm size    # browser bundle size
```

```bash
pnpm spike   # tagging spike: builds the example several times; see examples/next-app/spike-results
```

Tooling: pnpm workspaces, Turborepo, TypeScript (strict, ESM only), tsup for bundles and `tsc` for
declarations, Vitest, Biome, Changesets. Packages in this repo depend on each other with `workspace:^`,
which pnpm rewrites to a semver range on publish; packages from other repos are always semver ranges.

Releases: add a changeset with `pnpm changeset`. Nothing is published yet.
