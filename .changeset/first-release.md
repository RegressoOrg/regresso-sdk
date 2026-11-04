---
"@regresso/protocol": minor
"@regresso/browser": minor
"@regresso/unplugin": minor
"@regresso/next": minor
---

First public release.

- One client API for every adapter: `initRegresso({ publicKey, endpoint, sampleRate, consent, debug })` and `setConsent(granted)`.
- The build plugin injects the build id, public key and ingest URL, and uploads the build manifest to `/v1/builds` after a production build when `REGRESSO_BUILD_TOKEN` is set.
- `BuildUploadV1` type and validator in `@regresso/protocol`.
- Next.js: route templates from the App and Pages Router manifests, upload from `compiler.runAfterProductionCompile` (Next.js 15.4 or later).
