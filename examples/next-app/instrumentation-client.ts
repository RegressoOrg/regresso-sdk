import { initRegresso } from "@regresso/next/client";

// The public key (NEXT_PUBLIC_REGRESSO_KEY), the endpoint (REGRESSO_INGEST_URL) and the build id are
// injected by withRegresso() at build time. See .env.example.
initRegresso({
  sampleRate: 1,
  // With a consent manager, start "pending" and call setConsent(true) from its callback:
  //   import { setConsent } from "@regresso/next/client";
  //   cmp.on("consent", (c) => setConsent(c.analytics));
  consent: "granted",
  // Logs every beacon to the browser console.
  debug: process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_REGRESSO_DEBUG === "1",
});
