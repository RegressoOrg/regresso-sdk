# @regresso/protocol

The two wire formats of Regresso, with TypeScript types and validators:

- the **beacon** (browser → ingest Worker), sent by [`@regresso/browser`](../browser);
- the **build upload** (CI → API), sent by [`@regresso/unplugin`](../unplugin) at the end of a build.

No dependencies; runs in browsers, Cloudflare Workers and Node. Everything is tree-shakeable, so the browser
bundle only contains what the client uses.

## Install

```bash
npm install @regresso/protocol
```

## Usage

```ts
import { decodeBeacon } from "@regresso/protocol";

// In the ingest Worker
const result = decodeBeacon(await request.arrayBuffer());
if (!result.ok) return new Response(null, { status: 400 });
const beacon = result.value; // only known fields; safe to store as-is
```

| Export                              | What it does                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validateBeacon(value)`             | Validates a parsed value. Returns `{ ok: true, value }` with a fresh object holding only known fields, or `{ ok: false, issues }` with up to 20 `{ path, message }` entries. Never throws. |
| `decodeBeacon(body)`                | Size check (`MAX_BEACON_BYTES`, 8 KB), `JSON.parse`, then `validateBeacon`. Takes a string, `ArrayBuffer` or `Uint8Array`. Never throws.                                                   |
| `encodeBeacon(beacon)`              | Compact JSON, sent as a `text/plain` body.                                                                                                                                                 |
| `isBeacon(value)`                   | Type guard.                                                                                                                                                                                |
| `validateBuildUpload(value)`        | Validates a parsed build upload. Same result shape and guarantees as `validateBeacon`.                                                                                                      |
| `isBuildUpload(value)`              | Type guard.                                                                                                                                                                                |
| `BuildUploadV1`, `BuildUpload`, …   | Build upload types.                                                                                                                                                                       |
| `BeaconV1`, `Beacon`, …             | Types. `Beacon` is the union of every version this package decodes.                                                                                                                        |
| `*_RE`, `MAX_*`, `PROTOCOL_VERSION` | The formats and bounds the validator enforces.                                                                                                                                             |

## Beacon v1

One beacon per page view, sent when the page is hidden. All times are milliseconds.

```jsonc
{
  "v": 1, // protocol version
  "pk": "pk_live_8f2k…", // project public key
  "bid": "a1b2c3d-k9x2", // build id, injected at build time
  "p": "/products/blue-shoe", // pathname only; the edge maps it to a route template, then drops it
  "nav": "navigate", // navigation type (web-vitals)
  "sid": "Qx7_b2-9aZ01", // random per page view; not a user or session id
  "sr": 0.25, // sample rate in effect: this beacon stands for 1/sr page views
  "q": 0, // optional: sequence number within the page view
  "m": {
    // metrics measured so far; may be empty
    "lcp": {
      "v": 2140,
      "c": "k3j9x0ab",
      "el": "img",
      "ttfb": 320,
      "loadDelay": 110,
      "loadDuration": 900,
      "renderDelay": 810
    },
    "inp": {
      "v": 344,
      "c": "z9y8x7w6",
      "type": "pointer",
      "inputDelay": 12,
      "processing": 290,
      "presentation": 42,
      "load": "complete",
      "script": {
        "url": "https://example.com/_next/static/chunks/app.js",
        "dur": 270,
        "part": "processing-duration"
      }
    },
    "cls": { "v": 0.12, "c": "a0b1c2d3", "src": ["a0b1c2d3", "e4f5g6h7"], "largest": 0.09 },
    "fcp": { "v": 900, "ttfb": 320 },
    "ttfb": { "v": 320, "wait": 5, "cache": 0, "dns": 20, "conn": 40, "req": 255 }
  }
}
```

| Field                  | Type    | Rule                                                                                                                                                                                           |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                    | `1`     | Required.                                                                                                                                                                                      |
| `pk`                   | string  | `pk_` + 8–64 of `[0-9A-Za-z_-]`.                                                                                                                                                               |
| `bid`                  | string  | 1–64 of `[0-9A-Za-z._-]`.                                                                                                                                                                      |
| `p`                    | string  | Starts with `/`; no `?`, `#`, whitespace or control characters; ≤ 1024 chars.                                                                                                                  |
| `nav`                  | enum    | `navigate`, `reload`, `back-forward`, `back-forward-cache`, `prerender`, `restore`, `soft-navigation`.                                                                                         |
| `sid`                  | string  | 8–64 of `[0-9A-Za-z_-]`.                                                                                                                                                                       |
| `sr`                   | number  | 0 < sr ≤ 1.                                                                                                                                                                                    |
| `q`                    | integer | Optional, 0–1000. A page view that is hidden, shown and hidden again re-sends a fuller snapshot with the same `sid` and `q + 1`. **Consumers keep the beacon with the highest `q` per `sid`.** |
| `m.*.v`                | number  | ms metrics 0–3,600,000; CLS 0–100.                                                                                                                                                             |
| `m.*.c`, `m.cls.src[]` | string  | Component id (`data-cwv`): 6–16 of `[0-9a-z]`. The build plugin currently emits 8. Absent when the element has no tagged ancestor. `src` holds at most 5.                                      |
| `m.lcp.el`             | string  | Lower-case tag name, e.g. `img`.                                                                                                                                                               |
| `m.inp.type`           | enum    | `pointer`, `keyboard`.                                                                                                                                                                         |
| `m.inp.load`           | enum    | `loading`, `dom-interactive`, `dom-content-loaded`, `complete`.                                                                                                                                |
| `m.inp.script.url`     | string  | `http(s)://` URL with no query or fragment, ≤ 512 chars.                                                                                                                                       |
| `m.inp.script.part`    | enum    | `input-delay`, `processing-duration`, `presentation-delay`.                                                                                                                                    |
| breakdown fields       | number  | ms, 0–3,600,000. Required whenever their metric is present.                                                                                                                                    |

### Privacy

The schema is the privacy boundary. There is no field for element text, attributes, selectors, query
strings, full URLs, user ids, IPs or user agents, and the formats above reject values that could smuggle
them (for example, a pathname with a query string or a script URL with a token). Country and device class
are added at the edge from request metadata; the IP and user agent are never stored.

## Build upload v1

What `@regresso/unplugin` POSTs to `{REGRESSO_API_URL}/v1/builds` after a production build, gzip-encoded JSON
with `Authorization: Bearer <build token>`. The API answers `201 { buildId, projectId }`. It is also written to
`<dir>/manifest.json`, so you can see exactly what was sent.

```ts
import { validateBuildUpload } from "@regresso/protocol";

// In the API
const result = validateBuildUpload(JSON.parse(gunzip(body)));
if (!result.ok) return Response.json({ issues: result.issues }, { status: 400 });
```

```jsonc
{
  "v": 1,
  "framework": "next",                       // adapter or bundler
  "buildId": "a03fc282419b-mw19kh7c39cb",     // = the beacon's bid
  "gitSha": "a03fc282419bfd1453dfccc9d2f4e20a77d8e543",  // or null
  "branch": "main",                          // or null
  "env": "production",                       // production | preview | development
  "createdAt": "2026-11-04T12:00:00.000Z",
  "components": [
    { "id": "grnw4oy7", "name": "AddToCart", "file": "components/add-to-cart.tsx", "line": 6, "contentHash": "25d14e0d8eb550a3" }
  ],
  "routes": ["/", "/products/[slug]", "/blog/[...slug]", "/docs/[[...path]]"]
}
```

| Field | Type | Rule |
|---|---|---|
| `v` | `1` | Required. |
| `framework` | string | `[a-z0-9][a-z0-9.-]{0,31}`. |
| `buildId` | string | Same format as the beacon's `bid`. |
| `gitSha` | string \| null | 7–64 lower-case hex. Present, `null` when unknown. |
| `branch` | string \| null | ≤ 255 chars, no whitespace. Present, `null` when unknown. |
| `env` | enum | `production`, `preview`, `development`. Previews are excluded from deploy detection. |
| `createdAt` | string | ISO 8601 UTC (`toISOString()`). |
| `components[]` | object | At most 100,000. `id`: component id format; `name`: identifier ≤ 128 chars; `file`: repo-relative POSIX path, no leading `/` or `..`; `line`: ≥ 1; `contentHash`: 16–64 lower-case hex. |
| `routes[]` | string | At most 20,000 route templates in Next.js syntax (`[x]`, `[...x]`, `[[...x]]`), starting with `/`, no query, fragment, whitespace or route groups `(group)`. Matched against the beacon's pathname at the edge. |

The same compatibility rules apply as for the beacon, below.

## Compatibility rules

The ingest Worker validates with this package, and old clients stay cached in browsers and CDNs for months.
So:

1. **`v` is the major version.** A reader handles every version listed in `SUPPORTED_VERSIONS` and rejects
   any other with `unsupported version`.
2. **Within a version, changes are additive only.** Allowed: a new optional field, at any level. Not
   allowed: removing or renaming a field, changing its type, unit or meaning, making an optional field
   required, or tightening a format or bound. Any of those is a new major version.
3. **Readers ignore unknown fields.** `validateBeacon` drops them instead of failing, so a Worker built
   against an older 1.x accepts beacons from a newer 1.x client; it just doesn't store the new fields yet.
4. **New values ship reader-first.** Widening an enum, a format or a bound (say, a new `nav` value) is
   additive for the schema but would be rejected by an older Worker. Release it to the Worker before any
   client emits it: `protocol` → `ingest` → `browser`.
5. **A new major version is a new branch, not an edit.** Add `BeaconV2`, extend the `Beacon` union and
   `SUPPORTED_VERSIONS`, and keep decoding v1 for at least 12 months after the last v1-emitting client
   release. A client only ever emits one version.
6. **npm semver follows the schema.** An additive v1 change is a minor release; adding a new beacon
   version is a minor release too (readers gain support); dropping a version is a major release.

The tests in `test/protocol.test.ts` pin the current formats and bounds; a change that makes one of them
fail is a compatibility change and needs to follow these rules.

## Troubleshooting

- **`unsupported version`**: the input's `v` isn't one this release reads. Upgrade `@regresso/protocol` in the
  reader first (rule 4).
- **An issue for a field you didn't send**: validators report required fields as `required`; for the build
  upload, `gitSha` and `branch` must be present, as `null` when unknown.
- **A field is missing from `value`**: validators drop unknown fields (rule 3). Check its spelling against the
  types.
