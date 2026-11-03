# @regresso/unplugin

Build plugin that tags each component's outermost element with `data-cwv="<component_id>"` and writes a
build manifest, so a Core Web Vitals culprit element in the field can be traced back to a component, a file
and a line. Built on [unplugin](https://unplugin.unjs.io); the webpack integration is the one used and tested
today (through `@regresso/next`).

```ts
// webpack.config.js
import regresso from "@regresso/unplugin/webpack";

export default { plugins: [regresso({ manifest: { dir: "dist/regresso" } })] };
```

## What gets tagged

Module-level components: PascalCase function declarations, arrow functions and function expressions
(including inside `memo()` / `forwardRef()` / `React.memo()`), and default exports (an anonymous one is
named `default`). For each `return` of the component (or an arrow's expression body), the transform finds the
**outermost host elements** (lowercase tags) and adds the attribute after the tag name:

```tsx
export default async function ProductPage() {
  return (
    <Layout>                                  {/* a component: descend into its children */}
      <main data-cwv="d9evubkc">…</main>      {/* the outermost host element: tagged */}
    </Layout>
  );
}
```

It descends through fragments, other components' children, `cond ? a : b` and `a && b` / `a || b`, and stops
at the first host element on each path. It does not tag elements inside attribute values or callbacks
(`.map()`), components that render only other components, class components, or files that don't parse
(those are left unchanged). An explicit `data-cwv` is kept. Server components are tagged like any other
component: the attribute is plain JSX.

## IDs and hashes

- `component_id` = 8 base36 chars of SHA-256 over `"<repo-relative path>\0<component name>"`. It depends on
  nothing else, so it is identical across builds and machines, and changes only when a component is renamed
  or its file moves. A test pins the scheme.
- `content_hash` = 16 hex chars of SHA-256 over the component's source file. "Changed in this deploy" means
  its `content_hash` differs between two builds' manifests.
- `build_id` = 12 chars of the git SHA + a time-and-random nonce (one commit can be built twice), or
  whatever you pass as `buildId`.

## Manifest

```json
{
  "manifest_version": 1,
  "build_id": "a03fc282419b-mw19kh7c39cb",
  "git_sha": "a03fc282419bfd1453dfccc9d2f4e20a77d8e543",
  "components": [
    { "id": "grnw4oy7", "name": "AddToCart", "file": "examples/next-app/components/add-to-cart.tsx",
      "line": 6, "content_hash": "25d14e0d8eb550a3" }
  ]
}
```

Each compilation writes `<dir>/fragments/<name>.json` and then rebuilds `<dir>/manifest.json` from every
fragment with the same `build_id` (a Next.js build runs client, server and edge compilations, and server
components only reach the server one). On webpack, components are stored on `module.buildInfo` and read back
in `finishModules`, so modules restored from the persistent cache are included. Uploading the manifest is not
implemented yet.

## Options

| Option | Default |
|---|---|
| `root` | git repository root, else cwd. Paths in ids and the manifest are relative to it. |
| `include` / `exclude` | `/\.(jsx\|tsx\|js)$/` / `node_modules` |
| `buildId` | `makeBuildId(gitSha)` |
| `gitSha` | `REGRESSO_GIT_SHA`, common CI variables (`GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, …), then `git rev-parse HEAD` |
| `manifest` | `{ dir: "<cwd>/.regresso" }`; `false` to skip |
| `onManifest` | called with the merged manifest after each write |
