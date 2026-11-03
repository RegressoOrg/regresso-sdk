/**
 * Deliberate regressions, switched on at build time, e.g.
 * NEXT_PUBLIC_REGRESS=inp,cls pnpm build
 */
const flags = new Set((process.env.NEXT_PUBLIC_REGRESS ?? "").split(",").filter(Boolean));

export const regress = {
  /** AddToCart blocks the main thread for 250 ms on click. */
  inp: flags.has("inp"),
  /** PromoBanner is inserted above the content after load. */
  cls: flags.has("cls"),
  /** ProductGallery's hero image is lazy-loaded. */
  lcp: flags.has("lcp"),
};

export function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // block the main thread
  }
}
