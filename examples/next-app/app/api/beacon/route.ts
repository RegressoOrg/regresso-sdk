import { appendFile } from "node:fs/promises";
import { decodeBeacon } from "@regresso/protocol";

/**
 * Local stand-in for the ingest Worker: validates each beacon with @regresso/protocol and logs it.
 * Set BEACON_LOG=<file> to also append accepted beacons as JSON lines.
 */
export async function POST(request: Request) {
  const result = decodeBeacon(await request.text());
  if (!result.ok) {
    console.warn("[beacon] rejected", result.issues);
    return new Response(null, { status: 400 });
  }
  console.log("[beacon]", JSON.stringify(result.value));
  if (process.env.BEACON_LOG)
    await appendFile(process.env.BEACON_LOG, `${JSON.stringify(result.value)}\n`);
  return new Response(null, { status: 204 });
}
