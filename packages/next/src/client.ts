import { init, type RegressoOptions } from "@regresso/browser";

export type { RegressoOptions } from "@regresso/browser";

declare const __REGRESSO_BUILD_ID__: string | undefined;

/** Build id injected by `withRegresso`, or undefined when the app was not built with it. */
export const buildId: string | undefined =
  typeof __REGRESSO_BUILD_ID__ === "string" ? __REGRESSO_BUILD_ID__ : undefined;

/**
 * Starts Regresso in the browser. Call it from `instrumentation-client.ts`:
 *
 * ```ts
 * import { initRegresso } from "@regresso/next/client";
 * initRegresso({ pk: "pk_…", endpoint: "https://…" });
 * ```
 *
 * Does nothing when no build id is available (the app was not built through `withRegresso`),
 * because beacons without one cannot be compared across deploys.
 */
export function initRegresso(
  options: Omit<RegressoOptions, "buildId"> & { buildId?: string },
): void {
  const bid = options.buildId ?? buildId;
  if (!bid) {
    console.warn(
      "[regresso] no build id: wrap next.config with withRegresso() and build with webpack.",
    );
    return;
  }
  init({ ...options, buildId: bid });
}
