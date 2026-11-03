import { MAX_BEACON_BYTES } from "./constants.js";
import type { Beacon } from "./types.js";
import { type ValidationResult, validateBeacon } from "./validate.js";

/**
 * Encodes a beacon as the request body: compact JSON, sent as `text/plain` so the
 * browser skips the CORS preflight. Does not validate; the client builds beacons from typed fields.
 */
export function encodeBeacon(beacon: Beacon): string {
  return JSON.stringify(beacon);
}

let encoder: TextEncoder | undefined;

function utf8Length(s: string): number {
  // Every UTF-16 code unit encodes to at most 3 UTF-8 bytes, so skip the exact count when safe.
  if (s.length * 3 <= MAX_BEACON_BYTES) return s.length;
  encoder ??= new TextEncoder();
  return encoder.encode(s).byteLength;
}

/**
 * Decodes and validates a request body. Accepts the raw text or bytes.
 * Never throws: oversized bodies, bad JSON and schema errors all come back as issues.
 */
export function decodeBeacon(body: string | ArrayBuffer | Uint8Array): ValidationResult<Beacon> {
  let text: string;
  if (typeof body === "string") {
    if (utf8Length(body) > MAX_BEACON_BYTES) return tooLarge();
    text = body;
  } else {
    if (body.byteLength > MAX_BEACON_BYTES) return tooLarge();
    text = new TextDecoder().decode(body);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "", message: "invalid JSON" }] };
  }
  return validateBeacon(parsed);
}

function tooLarge(): ValidationResult<Beacon> {
  return { ok: false, issues: [{ path: "", message: `larger than ${MAX_BEACON_BYTES} bytes` }] };
}
