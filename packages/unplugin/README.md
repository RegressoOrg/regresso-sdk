# @regresso/unplugin

The framework-neutral half of every Regresso adapter. At build time it:

1. tags each component's outermost element with `data-cwv="<component_id>"`, so a Core Web Vitals culprit element
   in the field can be traced back to a component, a file and a line;
2. injects `__REGRESSO_BUILD__` (build id, public key, ingest URL) for [`@regresso/browser`](../browser);
3. writes the build manifest: components, routes, commit, branch and environment;
4. uploads it to Regresso at the end of a production build.

Built on [unplugin](https://unplugin.unjs.io). Webpack is the integration used and tested today (through
[`@regresso/next`](../next)); the Vite and Rollup hooks are in place for future adapters. Requires Node.js 22.12
or later.

If you use Next.js, install [`@regresso/next`](../next) instead; it configures all of this.

## Install

```bash
npm install @regresso/unplugin
```

## Usage

```js
// webpack.config.js
import regresso from "@regresso/unplugin/webpack";

export default {
  mode: "production",
  plugins: [
    regresso({
      manifest: { dir: "dist/regresso" },
      define: { publicKey: process.env.REGRESSO_PUBLIC_KEY },
      routes: ["/", "/products/[slug]"],
    }),
  ],
};
```

With `REGRESSO_BUILD_TOKEN` set, a production build (`mode: "production"`, not watching) ends with:

```
[regresso] uploaded build a03fc282419b-mw19kh7c39cb (148 components, 23 routes, project prj_…)
```

## Options

| Option | Default | What |
|---|---|---|
| `root` | git repository root, else cwd | Paths in ids and the manifest are relative to it. |
| `include` | `/\.(jsx\|tsx\|js)$/` | Files to tag. |
| `exclude` | `/node_modules/` | Files never to tag. |
| `framework` | the bundler (`webpack`, `vite`, …) | Recorded in the upload. Adapters pass their framework (`next`). |
| `buildId` | `makeBuildId(gitSha)` | Build id injected into the bundle and recorded in the manifest. |
| `gitSha` | `detectBuildContext().gitSha` | Commit of the build. |
| `manifest` | `{ dir: "<cwd>/.regresso" }` | Where the manifest goes; `name` names this compilation's fragment. `false` for none (and no upload). |
| `onManifest` | none | Called with the merged manifest after each write. |
| `routes` | `[]` | Route templates (Next.js syntax), or a function returning them. |
| `upload` | `true` | Upload at the end of a production build when `REGRESSO_BUILD_TOKEN` is set. |
| `define` | `{}` | Inject `__REGRESSO_BUILD__` on webpack and Vite. `publicKey`: the key from the framework's public env variable. `endpoint`: default `REGRESSO_INGEST_URL`. `false` to skip. |

## Environment variables

| Variable | Default | What |
|---|---|---|
| `REGRESSO_BUILD_TOKEN` | unset: no upload | Project build token, `sk_…`. Keep it secret: CI only. |
| `REGRESSO_API_URL` | `https://app.regresso.dev` | Upload target: `POST {REGRESSO_API_URL}/v1/builds`. |
| `REGRESSO_INGEST_URL` | `https://ingest.regresso.dev` (the client's default) | Beacon endpoint injected into the bundle. |
| `REGRESSO_STRICT` | unset | `1` or `true`: a failed upload throws and fails the build. |
| `REGRESSO_ENV` | detected | `production`, `preview` or `development`. |
| `REGRESSO_GIT_SHA`, `REGRESSO_BRANCH` | detected | Override commit and branch. |
| `REGRESSO_PRODUCTION_BRANCH` | `main` or `master` | Production branch for providers that don't expose it. |

## What gets tagged

Module-level components: PascalCase function declarations, arrow functions and function expressions (including
inside `memo()` / `forwardRef()` / `React.memo()`), and default exports (an anonymous one is named `default`).
For each `return` of the component (or an arrow's expression body), the transform finds the **outermost host
elements** (lowercase tags) and adds the attribute after the tag name:

```tsx
export default async function ProductPage() {
  return (
    <Layout>                                  {/* a component: descend into its children */}
      <main data-cwv="d9evubkc">…</main>      {/* the outermost host element: tagged */}
    </Layout>
  );
}
```

It descends through fragments, other components' children, `cond ? a : b` and `a && b` / `a || b`, and stops at
the first host element on each path. It does not tag elements inside attribute values or callbacks (`.map()`),
components that render only other components, class components, or files that don't parse (those are left
unchanged). An explicit `data-cwv` is kept. Server components are tagged like any other component: the attribute
is plain JSX.

## IDs and hashes

- `component_id` = 8 base36 chars of SHA-256 over `"<repo-relative path>\0<component name>"`. It depends on nothing
  else, so it is identical across builds and machines, and changes only when a component is renamed or its file
  moves. A test pins the scheme.
- `contentHash` = 16 hex chars of SHA-256 over the component's source file. "Changed in this deploy" means its
  `contentHash` differs between two builds' manifests.
- `buildId` = 12 chars of the git SHA + a time-and-random nonce (one commit can be built twice), or whatever you
  pass as `buildId` / set as `REGRESSO_BUILD_ID` in an adapter.

## Manifest and upload

`<dir>/manifest.json` is exactly the payload that is uploaded, a
[`BuildUploadV1`](../protocol#build-upload-v1):

```json
{
  "v": 1,
  "framework": "next",
  "buildId": "a03fc282419b-mw19kh7c39cb",
  "gitSha": "a03fc282419bfd1453dfccc9d2f4e20a77d8e543",
  "branch": "main",
  "env": "production",
  "createdAt": "2026-11-04T12:00:00.000Z",
  "components": [
    { "id": "grnw4oy7", "name": "AddToCart", "file": "components/add-to-cart.tsx", "line": 6, "contentHash": "25d14e0d8eb550a3" }
  ],
  "routes": ["/", "/products/[slug]"]
}
```

Each compilation writes `<dir>/fragments/<name>.json` and then rebuilds `manifest.json` from every fragment with
the same build id (a Next.js build runs client, server and edge compilations, and server components only reach
the server one). On webpack, components are stored on `module.buildInfo` and read back in `finishModules`, so
modules restored from the persistent cache are included.

The upload is `POST {REGRESSO_API_URL}/v1/builds` with `Authorization: Bearer <REGRESSO_BUILD_TOKEN>`,
`Content-Type: application/json` and `Content-Encoding: gzip`; the API answers `201 { buildId, projectId }`. The
payload is validated before sending. Network errors, timeouts (30 s), 408, 425, 429 and 5xx are retried up to 4
attempts with exponential backoff (1 s, 2 s, 4 s, ±20 %; `Retry-After` is honoured up to 30 s). Other 4xx are
not retried. **It fails open**: a failed upload logs a warning and the build succeeds, unless `REGRESSO_STRICT=1`.

### Commit, branch and environment

`detectBuildContext()` reads them from the provider, then falls back to `git`:

| Provider | Detected by | Commit | Branch | Environment |
|---|---|---|---|---|
| Vercel | `VERCEL=1` | `VERCEL_GIT_COMMIT_SHA` | `VERCEL_GIT_COMMIT_REF` | `VERCEL_ENV` (custom environments → `preview`) |
| Netlify | `NETLIFY=true` | `COMMIT_REF` | `HEAD` | `CONTEXT`: `production`; `dev` → `development`; else `preview` |
| Render | `RENDER=true` | `RENDER_GIT_COMMIT` | `RENDER_GIT_BRANCH` | `IS_PULL_REQUEST=true` → `preview`, else `production` |
| Cloudflare Pages | `CF_PAGES=1` | `CF_PAGES_COMMIT_SHA` | `CF_PAGES_BRANCH` | production branch → `production`, else `preview` |
| Cloudflare Workers Builds | `WORKERS_CI=1` | `WORKERS_CI_COMMIT_SHA` | `WORKERS_CI_BRANCH` | as Cloudflare Pages |
| GitHub Actions | `GITHUB_ACTIONS=true` | PR head SHA on `pull_request*`, else `GITHUB_SHA` | `GITHUB_HEAD_REF` / `GITHUB_REF_NAME` | PR → `preview`; tag or the repository's default branch → `production`; else `preview` |
| GitLab CI | `GITLAB_CI=true` | `CI_COMMIT_SHA` | MR source branch / `CI_COMMIT_BRANCH` | MR → `preview`; tag or `CI_DEFAULT_BRANCH` → `production`; else `preview` |
| other CI (`CI` set) | | `git rev-parse HEAD` | `git rev-parse --abbrev-ref HEAD` | production branch → `production`, else `preview` |
| no CI | | `git rev-parse HEAD` | `git rev-parse --abbrev-ref HEAD` | `development` |

"Production branch" is `REGRESSO_PRODUCTION_BRANCH`, else `main` or `master`. The `REGRESSO_*` variables override
everything.

## Building an adapter

Exports for adapters: `defineConstants`, `DEFINE_NAME`, `detectBuildContext`, `makeBuildId`, `repoRoot`,
`writeManifest`, `readManifest`, `buildManifest`, `finalizeBuild`, `uploadBuild`, `uploadConfigFromEnv`,
`transformJsx`, `componentId`, `contentHash`. See the [repository README](../../README.md#adding-a-framework-adapter).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `REGRESSO_BUILD_TOKEN is not set: the build manifest was written but not uploaded` | Expected locally. In CI, add the token as a secret. |
| `build upload failed: HTTP 401 …` / `403` | Wrong, revoked or other-project token. |
| `build upload failed: HTTP 404 (check REGRESSO_API_URL)` | `REGRESSO_API_URL` points somewhere without `/v1/builds`. |
| `build upload failed: TypeError: fetch failed (after 4 attempts)` | The API wasn't reachable from the build machine (CI network policy, proxy, typo in the URL). |
| `build upload failed: invalid manifest: …` | A component or route didn't pass `validateBuildUpload` (e.g. a route with a query string). The message names the field. |
| `build upload failed: REGRESSO_BUILD_TOKEN does not look like a build token (sk_…)` | The public key (`pk_…`) was put in the token variable. |
| No upload and no message | Not a production build: webpack `mode` isn't `production`, or the build is watching. |
| Components missing from the manifest | They render only other components, are class components, or live outside `include`. |
| Component ids changed between builds | A file moved or a component was renamed; ids are a hash of (path, name), nothing else. |
