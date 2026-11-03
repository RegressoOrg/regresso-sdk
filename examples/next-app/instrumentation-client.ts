import { initRegresso } from "@regresso/next/client";

initRegresso({
  pk: process.env.NEXT_PUBLIC_REGRESSO_PK ?? "pk_example_local",
  // Defaults to this app's own debug endpoint, which validates and logs each beacon.
  endpoint: process.env.NEXT_PUBLIC_REGRESSO_ENDPOINT ?? "/api/beacon",
  sampleRate: 1,
  // Replace with your consent manager's state, e.g. () => window.cmp?.analytics === true.
  consent: () => true,
});
