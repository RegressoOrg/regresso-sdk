/**
 * The constant the build plugin injects into client bundles and `@regresso/browser` reads.
 * One object, so every adapter injects the same thing:
 *
 *   __REGRESSO_BUILD__ = { buildId, publicKey?, endpoint? }
 */
export const DEFINE_NAME = "__REGRESSO_BUILD__";

export interface InjectedConfig {
  /** Build id of this build. Every beacon carries it. */
  buildId: string;
  /** Project public key from the framework's public env variable, when set. */
  publicKey?: string | undefined;
  /** Beacon endpoint from `REGRESSO_INGEST_URL`, when set. */
  endpoint?: string | undefined;
}

/** `{ [DEFINE_NAME]: "<json>" }`, ready for webpack's DefinePlugin or Vite's `define`. */
export function defineConstants(config: InjectedConfig): Record<string, string> {
  const value: Record<string, string> = { buildId: config.buildId };
  if (config.publicKey) value.publicKey = config.publicKey;
  if (config.endpoint) value.endpoint = config.endpoint;
  return { [DEFINE_NAME]: JSON.stringify(value) };
}
