/** Latest protocol version this package emits. */
export const PROTOCOL_VERSION = 1 as const;

/** Versions `validateBeacon` accepts. */
export const SUPPORTED_VERSIONS: readonly number[] = [1];

/** Largest encoded beacon accepted, in bytes (UTF-8). Real beacons are well under 1 KB. */
export const MAX_BEACON_BYTES = 8192;

/** Upper bound for any millisecond value (1 hour). */
export const MAX_MS = 3_600_000;

/** Upper bound for a CLS score. */
export const MAX_CLS = 100;

/** Most components listed in `m.cls.src`. */
export const MAX_SHIFT_SOURCES = 5;

/** `data-cwv` component id: base36, 6–16 characters. Generators currently emit 8. */
export const COMPONENT_ID_RE: RegExp = /^[0-9a-z]{6,16}$/;

/** Project public key. */
export const PUBLIC_KEY_RE: RegExp = /^pk_[0-9A-Za-z_-]{8,64}$/;

/** Build id. */
export const BUILD_ID_RE: RegExp = /^[0-9A-Za-z._-]{1,64}$/;

/** Page-view id. */
export const PAGE_VIEW_ID_RE: RegExp = /^[0-9A-Za-z_-]{8,64}$/;

/** Pathname: starts with `/`, no query, fragment, whitespace or control characters, ≤ 1024 chars. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
export const PATHNAME_RE: RegExp = /^\/[^?#\s\u0000-\u001f\u007f]{0,1023}$/;

/** Element tag name. */
export const TAG_NAME_RE: RegExp = /^[a-z][a-z0-9-]{0,31}$/;

/** Script URL: http(s), no query, fragment or whitespace, ≤ 512 chars. */
export const SCRIPT_URL_RE: RegExp = /^https?:\/\/[^?#\s]{1,504}$/;

export const NAVIGATION_TYPES: readonly string[] = [
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
  "soft-navigation",
];

export const LOAD_STATES: readonly string[] = [
  "loading",
  "dom-interactive",
  "dom-content-loaded",
  "complete",
];

export const INTERACTION_SUBPARTS: readonly string[] = [
  "input-delay",
  "processing-duration",
  "presentation-delay",
];

export const INTERACTION_TYPES: readonly string[] = ["pointer", "keyboard"];
