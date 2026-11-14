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

/** Maximum decoded response bytes buffered from any provider. */
export const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024

/** Maximum entries accepted in a provider-controlled daily or event collection. */
export const MAX_PROVIDER_COLLECTION_ITEMS = 25_000

const INITIAL_RESPONSE_BUFFER_BYTES = 16 * 1024

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

function responseSizeError(provider: string): ConnectorError {
  return new ConnectorError(
    `${provider} response exceeds the ${MAX_PROVIDER_RESPONSE_BYTES}-byte limit`,
  )
}

/**
 * Reads and parses a provider response without allowing a fast body to bypass
 * the request timeout's resource protection. The stream limit applies to the
 * decoded bytes exposed by fetch, including when Content-Length is absent or
 * describes a smaller encoded body.
 */
export async function readProviderJson(response: Response, provider: string): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed > MAX_PROVIDER_RESPONSE_BYTES) {
      throw responseSizeError(provider)
    }
  }

  const reader = response.body?.getReader()
  if (!reader) return JSON.parse('') as unknown

  let bytes = new Uint8Array(INITIAL_RESPONSE_BUFFER_BYTES)
  let length = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const nextLength = length + value.byteLength
      if (nextLength > MAX_PROVIDER_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Preserve the deterministic size error even if stream cancellation fails.
        }
        throw responseSizeError(provider)
      }

      if (nextLength > bytes.byteLength) {
        let capacity = bytes.byteLength
        while (capacity < nextLength) {
          capacity = Math.min(capacity * 2, MAX_PROVIDER_RESPONSE_BYTES)
        }
        const grown = new Uint8Array(capacity)
        grown.set(bytes.subarray(0, length))
        bytes = grown
      }
      bytes.set(value, length)
      length = nextLength
    }
  } finally {
    reader.releaseLock()
  }

  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length))) as unknown
}

/** Rejects provider collections before callers copy, sort, or traverse them. */
export function assertProviderCollectionLimit(
  collection: readonly unknown[] | Record<string, unknown>,
  provider: string,
  collectionName: string,
): void {
  if (Array.isArray(collection)) {
    if (collection.length <= MAX_PROVIDER_COLLECTION_ITEMS) return
  } else {
    let count = 0
    for (const key in collection) {
      if (!Object.prototype.hasOwnProperty.call(collection, key)) continue
      count += 1
      if (count > MAX_PROVIDER_COLLECTION_ITEMS) break
    }
    if (count <= MAX_PROVIDER_COLLECTION_ITEMS) return
  }

  throw new ConnectorError(
    `${provider} ${collectionName} exceeds the ${MAX_PROVIDER_COLLECTION_ITEMS}-item limit`,
  )
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
  /**
   * Requests per day the provider allows with the current credentials, or undefined when there is no
   * daily cap. Batch callers (the scoreboard) stay under it instead of turning the cap into failures.
   */
  dailyRequestLimit?(): number | undefined
}

/**
 * Splits a batch of symbols into the ones a connector can fetch today and the ones over its daily cap.
 * Order is kept, so the same basket always skips the same symbols. A limit of undefined means no cap.
 */
export function splitByDailyLimit<T>(items: readonly T[], limit: number | undefined): { attempt: T[]; skip: T[] } {
  if (limit === undefined || !Number.isFinite(limit) || limit >= items.length) return { attempt: [...items], skip: [] }
  const cut = Math.max(0, Math.floor(limit))
  return { attempt: items.slice(0, cut), skip: items.slice(cut) }
}
