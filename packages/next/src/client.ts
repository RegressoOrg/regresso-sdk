/**
 * The browser entry for Next.js. Import it from `instrumentation-client.ts`:
 *
 * ```ts
 * import { initRegresso } from "@regresso/next/client";
 * initRegresso();
 * ```
 *
 * It is `@regresso/browser`: `withRegresso` injects the build id, `NEXT_PUBLIC_REGRESSO_KEY` and
 * `REGRESSO_INGEST_URL` at build time, so no options are required.
 */
export {
  type Consent,
  DEFAULT_ENDPOINT,
  initRegresso,
  type RegressoOptions,
  setConsent,
} from "@regresso/browser";
