# regresso-sdk

Client and build-time packages for Regresso: Core Web Vitals regression alerts that name the component and PR
that caused them.

**Using Next.js?** Start with the [`@regresso/next` quickstart](packages/next#readme).

## Packages and how they layer

```
@regresso/protocol    schemas: the beacon (browser → ingest) and the build upload (CI → API). No dependencies.
        ▲
@regresso/browser     the client: web-vitals → nearest data-cwv → one beacon per page view.
        ▲             initRegresso() and setConsent(), the same in every framework.
@regresso/unplugin    the build plugin: tags components, injects the build id, writes the manifest,
        ▲             detects CI (commit, branch, env), uploads the build. Framework-neutral.
@regresso/next        the Next.js adapter: wires the plugin into webpack, reads Next's route manifests,
                      re-exports the client from @regresso/next/client.
```

| Package | What it does |
|---|---|
| [`@regresso/protocol`](packages/protocol) | Beacon v1 and build upload v1: types, validators, codec. Shared with the ingest Worker and the API. |
| [`@regresso/browser`](packages/browser) | Browser client. 7.0 KB gzip including `web-vitals/attribution` (1.8 KB of it is Regresso). |
| [`@regresso/unplugin`](packages/unplugin) | Build plugin (webpack today, built on unplugin): `data-cwv` tagging, manifest, upload. |
| [`@regresso/next`](packages/next) | `withRegresso(nextConfig)` and `@regresso/next/client`. |
| [`examples/next-app`](examples/next-app) | App Router fixture with server and client components and switchable regressions. |

The public surface is the same in every framework:

- **Client:** `initRegresso({ publicKey, endpoint, sampleRate, consent, debug })` and `setConsent(granted)`, from
  `@regresso/browser`, re-exported by each adapter's client entry.
- **Environment:** the framework's public prefix for the key (`NEXT_PUBLIC_REGRESSO_KEY` on Next.js), and the
  same build-side variables everywhere:

| Variable | Default | Used for |
|---|---|---|
| `REGRESSO_BUILD_TOKEN` | unset: no upload | Secret build token (`sk_…`) that authorises the build upload. CI only. |
| `REGRESSO_API_URL` | `https://app.regresso.dev` | Where builds are uploaded (`POST /v1/builds`). |
| `REGRESSO_INGEST_URL` | `https://ingest.regresso.dev` | Beacon endpoint, injected into the client bundle. |
| `REGRESSO_STRICT` | unset | `1` fails the build when the upload fails. Otherwise it warns and the build continues. |
| `REGRESSO_ENV` | detected | `production`, `preview` or `development`, if detection gets it wrong. |
| `REGRESSO_GIT_SHA`, `REGRESSO_BRANCH` | detected | Override the commit and branch read from CI or git. |
| `REGRESSO_PRODUCTION_BRANCH` | `main`/`master` | For CIs that don't say which branch is production. |
| `REGRESSO_BUILD_ID` | generated | Choose the build id yourself. |

## Adding a framework adapter

An adapter (React + Vite, Nuxt, SvelteKit, Astro…) is framework glue only. Everything else is shared:

| Shared, don't reimplement | Where |
|---|---|
| JSX tagging, component ids, content hashes | `@regresso/unplugin` (`transformJsx`, `componentId`) |
| Injecting `__REGRESSO_BUILD__` (build id, public key, ingest URL) | the plugin's `define` option (webpack and Vite) |
| CI detection: commit, branch, env | `detectBuildContext()` |
| Manifest fragments, merging, upload, retries, fail-open | `writeManifest()`, `finalizeBuild()`, `uploadBuild()` |
| Client: measuring, attribution, sampling, consent, sending | `@regresso/browser` |

An adapter package `@regresso/<framework>` then does three things:

1. **Wire the plugin** into the framework's bundler config, with `framework: "<name>"` and
   `define: { publicKey: <the framework's public env variable> }` (Vite: `VITE_REGRESSO_KEY`, Nuxt:
   `NUXT_PUBLIC_REGRESSO_KEY`, SvelteKit: `PUBLIC_REGRESSO_KEY`, Astro: `PUBLIC_REGRESSO_KEY`).
2. **Supply route templates** in Next.js syntax (`/blog/[slug]`, `/docs/[...path]`, `/[[...opt]]`, route groups
   stripped), from the framework's own route manifest or file convention. If the framework builds in one
   compilation, pass them as the plugin's `routes` option and let it upload. If it runs several (client + SSR),
   pass `upload: false` and call `finalizeBuild(dir, { routes })` once from the framework's "build finished" hook,
   as `@regresso/next` does with `runAfterProductionCompile`.
3. **Re-export the client** from a `/client` entry: `export { initRegresso, setConsent } from "@regresso/browser"`,
   plus any framework-specific mounting (a Nuxt plugin, a SvelteKit `hooks.client.ts` snippet).

Then copy `scripts/pack-test.mjs` to build a fresh app of that framework from the packed tarballs.

## Development

Node 22 and pnpm 10.

```bash
pnpm install
```

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint
```

```bash
pnpm size        # browser bundle size
```

```bash
pnpm pack:test   # pack every package, install into a fresh Next.js app outside the workspace, build, check
```

```bash
pnpm spike       # tagging spike: builds the example several times; see examples/next-app/spike-results
```

Tooling: pnpm workspaces, Turborepo, TypeScript (strict, ESM only), tsup for bundles and `tsc` for
declarations, Vitest, Biome, Changesets. Packages in this repo depend on each other with `workspace:^`,
which pnpm rewrites to a semver range on publish; packages from other repos are always semver ranges.

## Releasing

Packages publish publicly under the `@regresso` npm scope, versioned together (Changesets `fixed` group) and
at `0.x` until the API is stable: a breaking change is a minor bump, anything else a patch.

1. On an up-to-date, clean `main`, run `pnpm release`. It asks for a major, minor or patch bump and a one-line
   changelog note, runs the checks, shows the resulting version and asks you to confirm. `pnpm release --dry-run`
   shows the outcome without running the checks or changing anything.
2. On confirmation it commits the new versions and changelogs to `main` and pushes a `vX.Y.Z` tag.
3. The tag triggers the Release workflow, which stages all four packages on npm from CI.
4. Approve each package with 2FA from its **Staged Packages** tab on npmjs.com, in dependency order:
   `@regresso/protocol`, `@regresso/browser`, `@regresso/unplugin`, `@regresso/next`. Nothing is public until then.

`pnpm changeset` is optional. Any changeset files in the repo are added to the next release's changelog, and if
one asks for a larger bump than the one you pick, the larger bump applies.

Publishing uses npm trusted publishing, so no npm token is stored, and each trusted publisher is stage-only, so CI
can't publish directly. Each `@regresso` package's trusted publisher on npmjs.com names this repo and `release.yml`,
so renaming the workflow file breaks publishing. The repository must stay public, because npm rejects provenance
from private ones, and `pnpm release` checks this before it starts. A new package needs one token-based publish before its trusted publisher can be added.
