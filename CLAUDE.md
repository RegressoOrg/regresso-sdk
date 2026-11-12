# regresso-sdk

The npm packages customers install. This repo is public (MIT) and the packages are on npm, so everything here is visible to anyone: no internal URLs, customer names or secrets.

Part of the Regresso workspace (meta-repo: RegressoOrg/regresso, checked out as a submodule). Product, architecture and open decisions live in the meta-repo: `../CLAUDE.md`, `../docs/business-plan.md`, `../docs/architecture/backend-exploration.md`. Read them before making design decisions; if this repo is checked out on its own, ask for them.

Commit and push changes in this repo first, then bump the submodule pointer in the meta-repo.

## Scope
- `packages/protocol`: beacon schema and types (`@regresso/protocol`). The ingest Worker depends on this, so schema changes are versioned and backward compatible (`v` field).
- `packages/browser`: `@regresso/browser`. web-vitals attribution, walk to nearest `data-cwv`, batched beacon, sampling, consent hook.
- `packages/unplugin`: `@regresso/unplugin`. JSX transform adding `data-cwv`, manifest builder and uploader.
- `packages/next`: `@regresso/next`. `withRegresso(nextConfig)`, route manifest, build_id injection.
- `examples/next-app`: fixture app with deliberately regressable components.

## Rules
- Browser bundle size is a feature: tiny, dependency-light, no PII (architecture doc §2.1).
- `component_id` must stay stable across builds (architecture doc §4.1).
