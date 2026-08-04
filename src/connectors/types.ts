import type { MarketDataSet } from '../schema/market-data'

/**
 * The connector contract — providers are plugins, never core.
 *
 * A connector knows how to turn one provider's API into the canonical
 * dataset. Everything downstream (rules engine, comparison, reports) works
 * on that schema and never learns where the data came from — except
 * `source`, which is mandatory provenance.
 */

export interface FetchOptions {
  /** How much history to fetch, provider-specific (e.g. '1mo', '1y', '5y'). */
  range?: string
  /**
   * Per-request timeout in milliseconds (default DEFAULT_TIMEOUT_MS). Without
   * it a hung provider stalls the caller forever — reproduced in the 2026-07-31
   * audit: a silent socket hang kept the CLI waiting indefinitely.
   */
  timeoutMs?: number
}

/** Default per-request timeout for connector HTTP calls. */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * True when `error` is the rejection produced by a fired AbortSignal.timeout
 * (a TimeoutError DOMException). Structural check: DOMException does not
 * reliably extend Error across supported runtimes.
 */
export function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'TimeoutError'
  )
}

export class ConnectorError extends Error {
  override name = 'ConnectorError'
}

export interface Connector {
  /** Provider name, also used as the dataset's `source`. */
  readonly name: string
  /** Human-readable note on what this connector needs (shown in errors/help). */
  readonly requires: string
  /** Whether the connector can be used right now (e.g. API key present). */
  available(): boolean
  /** Fetches daily OHLCV (+ dividends/splits if the provider offers them) normalized to the schema. */
  fetchDaily(symbol: string, options?: FetchOptions): Promise<MarketDataSet>
}
