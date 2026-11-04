# @regresso/next

Regresso for Next.js: Core Web Vitals from real users, attributed to the component that caused them, compared
build against build. App Router and Pages Router, webpack builds.

Requirements: Next.js 15.4 or later, Node.js 22.12 or later at build time, and builds run with `--webpack`
(see [Turbopack](#turbopack)).

## Quickstart

### 1. Install

```bash
npm install @regresso/next
```

(`pnpm add @regresso/next` or `yarn add @regresso/next` work the same.)

### 2. Wrap your Next.js config

```ts
// next.config.ts
import { withRegresso } from "@regresso/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // your config
};

export default withRegresso(nextConfig);
```

`withRegresso` also accepts a config function (`export default withRegresso(async (phase) => ({ … }))`).
It keeps your own `webpack` and `compiler.runAfterProductionCompile` hooks.

### 3. Start the client

Create `instrumentation-client.ts` at the project root (next to `app/` or `pages/`, or in `src/` if you use one):

```ts
// instrumentation-client.ts
import { initRegresso } from "@regresso/next/client";

initRegresso();
```

That's all the client needs: `withRegresso` injects the build id, your public key and the beacon endpoint
at build time. Options are under [Client options](#client-options).

### 4. Build with webpack

Next.js 16 builds with Turbopack by default. Add `--webpack` to your scripts:

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack",
    "start": "next start"
  }
}
```

On Next.js 15, webpack is already the default and the flag isn't needed.

### 5. Set the environment variables

Locally, in `.env.local`:

```bash
NEXT_PUBLIC_REGRESSO_KEY=pk_live_…
```

In CI, or wherever your production builds run (Vercel, Netlify, Render, Cloudflare, GitHub Actions…), set both:

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_REGRESSO_KEY` | build environment | The project's public key (`pk_…`). It ends up in the page; that's expected. |
| `REGRESSO_BUILD_TOKEN` | build environment, **secret** | The project's build token (`sk_…`). Uploads the build manifest after `next build`. Never prefix it with `NEXT_PUBLIC_`. |

Both come from the project's settings in Regresso. Without the token everything still works, but Regresso
can't map component ids to files or route templates to builds, so set it on every environment that deploys.

Optional:

| Variable | Default | What |
|---|---|---|
| `REGRESSO_INGEST_URL` | `https://ingest.regresso.dev` | Beacon endpoint, read at build time. |
| `REGRESSO_API_URL` | `https://app.regresso.dev` | Where the build is uploaded. |
| `REGRESSO_STRICT` | unset | `1`: a failed upload fails the build. Default: warn and continue. |
| `REGRESSO_ENV` | detected | `production`, `preview` or `development`. Previews are kept out of deploy comparisons. |
| `REGRESSO_PRODUCTION_BRANCH` | `main` or `master` | For providers that don't say which branch is production (Cloudflare, unknown CIs). |
| `REGRESSO_GIT_SHA`, `REGRESSO_BRANCH` | detected | When the build has no `.git` and no CI variables (a Docker build, say). |
| `REGRESSO_BUILD_ID` | generated | Pick the build id yourself. |

The commit, branch and environment are read from Vercel, Netlify, Render, Cloudflare Pages and Workers Builds,
GitHub Actions and GitLab CI, falling back to `git`. A build outside any CI counts as `development`.

### 6. Check it works

Turn on debug logging:

```ts
initRegresso({ debug: true });
```

Build and start the app (`next build --webpack && next start`), open a page, then switch tabs or minimise
the window: the page being hidden is when the beacon is sent. The browser console shows:

```
[regresso] started { pk: "pk_live_…", bid: "a03fc282419b-mw19kh7c39cb", endpoint: "https://ingest.regresso.dev", sr: 1, consent: "granted" }
[regresso] beacon { v: 1, p: "/products/blue-shoe", m: { lcp: { v: 1840, c: "d9evubkc", el: "img", … }, … } }
```

The build output shows the upload:

```
[regresso] uploaded build a03fc282419b-mw19kh7c39cb (148 components, 23 routes, project prj_…)
```

and `.next/regresso/manifest.json` holds exactly what was uploaded. In the HTML, your components' outermost
elements carry `data-cwv="…"` attributes. Remove `debug: true` before shipping, or keep it for
non-production builds only: `debug: process.env.NODE_ENV !== "production"`.

## Consent

By default beacons are sent (`consent: "granted"`). If analytics needs consent on your site, start pending and
grant it from your consent manager:

```ts
// instrumentation-client.ts
import { initRegresso, setConsent } from "@regresso/next/client";

initRegresso({ consent: "pending" });

// Call setConsent from your consent manager's callback; the API differs per CMP.
myConsentManager.onChange((choices) => setConsent(choices.analytics === true));
```

While consent is pending, metrics are measured but nothing leaves the browser. `setConsent(true)` sends
anything already held (if the page was hidden meanwhile) and lets later beacons go; `setConsent(false)` holds
them again. If the page is closed while pending, its beacon is dropped. `setConsent` can be called before
`initRegresso`, and then wins over the `consent` option.

Beacons carry no personal data: no cookies, no user or session id, no query string, no element text. See
[`@regresso/protocol`](../protocol#privacy).

## Sampling

```ts
initRegresso({ sampleRate: 0.25 }); // measure one page view in four
```

The decision is made once per page load; unsampled pages register no observers. Each beacon records the rate
so Regresso scales counts back up. Sample when you have a lot of traffic or a beacon quota to stay within;
regressions in low-traffic routes take longer to detect at low rates.

## Client options

`initRegresso(options?)` from `@regresso/next/client` (it is [`@regresso/browser`](../browser)'s):

| Option | Default | What |
|---|---|---|
| `publicKey` | `NEXT_PUBLIC_REGRESSO_KEY` at build time | Project public key, `pk_…`. |
| `endpoint` | `REGRESSO_INGEST_URL` at build time, else `https://ingest.regresso.dev` | Where beacons are POSTed. |
| `sampleRate` | `1` | Share of page views measured, 0 < rate ≤ 1. |
| `consent` | `"granted"` | `"pending"` measures but holds beacons until `setConsent(true)`. |
| `debug` | `false` | Log the configuration, sampling, consent holds and every beacon to the console. |
| `buildId` | injected by `withRegresso` | Only for setups that inject it some other way. |

`setConsent(granted: boolean)` as described under [Consent](#consent).

## `withRegresso(config, options?)`

| Option | Default | What |
|---|---|---|
| `enabled` | `true` | `false` returns your config unchanged: no tagging, no build id, no upload. |
| `upload` | `true` | Upload after `next build` when `REGRESSO_BUILD_TOKEN` is set. `false` writes the manifest only. |
| `root` | git repository root | Component paths in the manifest are relative to it. |
| `include` | `.jsx`/`.tsx`/`.js` inside the project directory | Files to tag. Linked workspace packages are not tagged. |
| `exclude` | `node_modules` | Files never to tag. |
| `manifestInDev` | `false` | Also write the manifest during `next dev`. |
| `onManifest` | none | Called with the manifest after each compilation writes it. |

What it does:

- adds [`@regresso/unplugin`](../unplugin) to the client, server and edge webpack compilations, so every component in
  your project, server components included, gets `data-cwv` on its outermost element;
- injects one build id per build (shared by Next's build workers), `NEXT_PUBLIC_REGRESSO_KEY` and
  `REGRESSO_INGEST_URL`, which the client reads;
- writes `<distDir>/regresso/manifest.json` from all compilations;
- after compilation (`compiler.runAfterProductionCompile`), adds the route templates from Next's App Router and
  Pages Router manifests (route groups and parallel-route slots stripped, interception routes, API routes and
  Next's own pages left out, `basePath` prepended) and uploads the manifest.

## Turbopack

Not supported yet. Under Turbopack nothing is tagged and no build id is injected, so `withRegresso` warns at
build time and `initRegresso` logs `not started: missing or invalid buildId` and does nothing: beacons without a
build id can't be compared across deploys. Use `next build --webpack` and `next dev --webpack`.

## Troubleshooting

**`[regresso] not started: missing or invalid publicKey`** — `NEXT_PUBLIC_REGRESSO_KEY` wasn't set when the app
was *built*. `NEXT_PUBLIC_` variables are inlined at build time, so setting it only at runtime has no effect. Set
it in the build environment and rebuild.

**`[regresso] not started: missing or invalid buildId`** — the build didn't go through `withRegresso` with webpack.
Check that `next.config` exports `withRegresso(…)` and that the build ran with `--webpack`.

**`[regresso] not started: missing or invalid sampleRate`** — `sampleRate` must be greater than 0 and at most 1.

**No beacon in the console** — beacons go out when the page is hidden, not on load: switch tabs. With
`sampleRate` below 1, `debug` logs `not sampled` for skipped page views. With `consent: "pending"`, it logs
`consent pending, held` until `setConsent(true)`.

**Beacons are sent but rejected (403 in the network tab)** — the page's origin isn't on the project's allowed
origins, or the key is disabled. Check the project settings. `sendBeacon` ignores responses; the status is
there for debugging.

**`[regresso] REGRESSO_BUILD_TOKEN is not set: the build manifest was written but not uploaded`** — expected locally.
In CI, add the token as a secret environment variable of the build step.

**`build upload failed: HTTP 401 (check REGRESSO_BUILD_TOKEN …)`** — the token is wrong, revoked, or belongs
to another project. The build still succeeds unless `REGRESSO_STRICT=1`.

**`build upload failed: … (after 4 attempts)`** — the API couldn't be reached (network policy in CI, wrong
`REGRESSO_API_URL`). Uploads are retried with backoff; the build is never failed unless `REGRESSO_STRICT=1`.

**`build not uploaded: no manifest … no components were tagged`** — the build ran with Turbopack, or `include`
matches no files.

**Preview deploys counted as production** — set `REGRESSO_ENV=preview` on those builds, or
`REGRESSO_PRODUCTION_BRANCH` if your production branch isn't `main` or `master`.
