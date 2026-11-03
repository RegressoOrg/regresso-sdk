# @regresso/browser

The Regresso browser client. Measures LCP, INP, CLS, FCP and TTFB with `web-vitals/attribution`,
attributes each one to the component that owns the culprit element (its nearest `data-cwv` ancestor),
and sends one beacon per page view when the page is hidden.

Size: **6.9 KB gzip** including `web-vitals/attribution` (1.5 KB of it is this package). Run
`pnpm size` for current numbers.

```ts
import { init } from "@regresso/browser";

init({
  pk: "pk_…",                    // project public key
  endpoint: "https://…/b",       // where beacons are POSTed
  buildId: BUILD_ID,             // injected at build time; @regresso/next does this for you
  sampleRate: 0.25,              // optional, default 1
  consent: () => cmp.analytics,  // optional, default () => true
});
```

On Next.js, use `initRegresso` from `@regresso/next/client` in `instrumentation-client.ts` instead; it
fills in `buildId`.

## Behavior

- **One beacon per page view**, sent from `visibilitychange` → hidden with `navigator.sendBeacon` and a
  `text/plain` body (no CORS preflight), falling back to `fetch(…, { keepalive: true })`. The listener sits
  on `document`, so it runs after web-vitals' own `window` capture listeners and sees the final CLS, INP and
  LCP. If the page is shown and hidden again with new data, the same `sid` is re-sent with `q + 1`.
- **A bfcache restore is a new page view** (new `sid`), following web-vitals' `navigationId`.
- **Sampling** is decided once per page load with `Math.random() < sampleRate`. Unsampled pages register
  nothing. `sr` on each beacon records the rate so counts can be scaled back up.
- **Consent** is checked synchronously each time a beacon is about to go out. While it returns false (or
  throws) the beacon is held; it goes out at the next hide once consent is given, and is dropped if the page
  is closed first.
- `init` is idempotent and does nothing during SSR.

## Privacy

Beacons carry the pathname only (no query or fragment), component ids, tag names, timings and script URLs
stripped to origin + path. web-vitals' CSS-selector targets are never sent: `generateTarget` returns the
component id or `""`. No element text, no attributes, no user or session id: `sid` is random per page view.
The beacon format is enforced by [`@regresso/protocol`](../protocol).

## Known limits

- An interaction in the last moments before the page is hidden can be missing from INP: web-vitals 6
  processes interactions in an idle callback (up to 1 s), and on hide it reports before handling one still
  pending. A click that immediately navigates away is the common case.
- Soft navigations (client-side route changes) are not separate page views yet: metrics after a client-side
  navigation are reported against the landing pathname.
