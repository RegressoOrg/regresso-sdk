# @regresso/browser

The Regresso browser client. Measures LCP, INP, CLS, FCP and TTFB with `web-vitals/attribution`, attributes each
one to the component that owns the culprit element (its nearest `data-cwv` ancestor), and sends one beacon per
page view when the page is hidden.

Size: **7.0 KB gzip** including `web-vitals/attribution` (1.8 KB of it is this package). Run `pnpm size` in the
repository for current numbers.

You normally don't install this package directly: each framework adapter re-exports it from its client entry
(`@regresso/next/client`) and its build plugin injects the build id, the public key and the endpoint.

## Install

```bash
npm install @regresso/browser
```

## Usage

```ts
import { initRegresso, setConsent } from "@regresso/browser";

initRegresso({
  sampleRate: 0.25,
  consent: "pending",
});

// later, from your consent manager
setConsent(true);
```

Without an adapter, add [`@regresso/unplugin`](../unplugin) to your bundler, or pass `publicKey` and `buildId`
yourself. The build id must be the one the build was uploaded with.

## API

### `initRegresso(options?)`

Starts measuring this page load. Call it once, as early as possible on the client. Later calls are ignored; on the
server it does nothing.

| Option | Default | What |
|---|---|---|
| `publicKey` | injected at build time from the framework's public env variable (`NEXT_PUBLIC_REGRESSO_KEY` on Next.js) | Project public key, `pk_…`. |
| `endpoint` | `REGRESSO_INGEST_URL` at build time, else `https://ingest.regresso.dev` | Where beacons are POSTed. |
| `sampleRate` | `1` | Share of page views measured, 0 < rate ≤ 1. |
| `consent` | `"granted"` | `"pending"`: measure, but hold beacons until `setConsent(true)`. |
| `debug` | `false` | Log the configuration, sampling decision, consent holds and every beacon with `console.info`. |
| `buildId` | injected at build time | Build id of the running bundle. |

"Injected at build time" means the build plugin's `__REGRESSO_BUILD__` constant. Options always win over it.

### `setConsent(granted: boolean)`

`true` lets beacons go out and immediately sends one that was held at a hide while consent was pending.
`false` holds beacons again. Safe to call before `initRegresso` (it then overrides the `consent` option) and on
the server.

### `DEFAULT_ENDPOINT`, `nearestComponent(node)`, `ATTR`

The default endpoint, the `data-cwv` walker used for attribution, and the attribute name.

## Behavior

- **One beacon per page view**, sent from `visibilitychange` → hidden with `navigator.sendBeacon` and a
  `text/plain` body (no CORS preflight), falling back to `fetch(…, { keepalive: true })`. The listener sits on
  `document`, so it runs after web-vitals' own `window` capture listeners and sees the final CLS, INP and LCP. If
  the page is shown and hidden again with new data, the same `sid` is re-sent with `q + 1`.
- **A bfcache restore is a new page view** (new `sid`), following web-vitals' `navigationId`.
- **Sampling** is decided once per page load with `Math.random() < sampleRate`. Unsampled pages register
  nothing. `sr` on each beacon records the rate so counts can be scaled back up.
- **Consent pending** means metrics are measured but not sent. A hide while pending holds the beacon; granting
  sends it right away. A page closed while pending sends nothing.
- **Missing configuration** (no public key, no build id, a bad sample rate) logs one `console.warn` and starts
  nothing, even without `debug`, because the ingest would reject every beacon.

## Privacy

Beacons carry the pathname only (no query or fragment), component ids, tag names, timings and script URLs
stripped to origin + path. web-vitals' CSS-selector targets are never sent: `generateTarget` returns the
component id or `""`. No element text, no attributes, no cookies, no user or session id: `sid` is random per page
view. The beacon format is enforced by [`@regresso/protocol`](../protocol).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `[regresso] not started: missing or invalid publicKey` | No `publicKey` option and none injected. With an adapter, the public env variable wasn't set when the app was built. |
| `[regresso] not started: missing or invalid buildId` | The bundle wasn't built through the build plugin (on Next.js: `withRegresso` with `--webpack`). |
| `[regresso] not started: missing or invalid sampleRate` | `sampleRate` must be in (0, 1]. |
| No beacon on load | Expected: beacons go out when the page is hidden. Switch tabs to trigger one. |
| `debug` shows `not sampled` | That page load lost the sampling draw. Use `sampleRate: 1` while testing. |
| `debug` shows `consent pending, held` | `consent: "pending"` and `setConsent(true)` hasn't been called. |
| INP missing on a page view | An interaction in the last moments before the page is hidden can be missed: web-vitals processes interactions in an idle callback (up to 1 s). A click that navigates away immediately is the common case. |
| Metrics after a client-side navigation are reported under the landing path | Soft navigations are not separate page views yet. |
