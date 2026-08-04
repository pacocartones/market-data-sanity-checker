import type { Bar, Dividend, MarketDataSet, Split } from '../schema/market-data'
import { ConnectorError, DEFAULT_TIMEOUT_MS, isTimeoutError, type Connector, type FetchOptions } from './types'

/**
 * Yahoo Finance connector — chart API v8, keyless.
 *
 * Two parts, by design:
 * - `parseYahooChart` is a pure, total function from the raw JSON payload to
 *   the canonical dataset. Every tricky decision lives here and is tested
 *   offline against recorded real responses (tests/fixtures/yahoo-chart-*.json).
 * - `yahoo.fetchDaily` is a thin fetch wrapper: build the URL, set a
 *   User-Agent (Yahoo answers 429/403 without one), bound the wait with
 *   AbortSignal.timeout (a hung provider must fail fast, not stall the caller),
 *   delegate to the parser.
 *
 * Two Yahoo-specific traps this module handles explicitly:
 * - Timestamps are epoch SECONDS in the exchange's local session time.
 *   Converting them with plain UTC shifts the calendar day for markets whose
 *   local clock crosses midnight relative to UTC (Asia-Pacific sessions, US
 *   extended hours), so every date — bars, dividends and splits alike — is
 *   derived with the exchange's `gmtoffset`. A one-day shift is exactly the
 *   failure documented in fixtures like tety-st-misplaced-exdate.json.
 * - Yahoo emits null OHLCV entries for halted/suspended sessions. Those bars
 *   are skipped, never zero-filled: a fabricated 0 close poisons every
 *   downstream rule (bad-tick detectors, comparisons, scores).
 */

const DEFAULT_RANGE = '1y'

/** Yahoo rejects requests without a browser-ish User-Agent (HTTP 429/403). */
const USER_AGENT = 'Mozilla/5.0 (market-data-sanity-checker)'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberAt(values: unknown, index: number): number | undefined {
  return Array.isArray(values) ? asFiniteNumber(values[index]) : undefined
}

/**
 * Exchange-local trading date (YYYY-MM-DD) for an epoch-seconds timestamp.
 * Using plain UTC here shifts the day for non-US markets — see module docs.
 */
function marketDate(epochSeconds: number, gmtOffsetSeconds: number): string {
  return new Date((epochSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10)
}

/**
 * Converts a Yahoo chart API v8 payload into the canonical dataset.
 *
 * `requestedSymbol` is the fallback when the payload's meta omits the symbol,
 * and it makes error messages actionable.
 *
 * @throws {ConnectorError} when the payload is not a chart response, carries a
 *   `chart.error` (Yahoo's "symbol not found / delisted" shape), has an empty
 *   or missing `result`, or lacks the timestamp/quote arrays — i.e. when there
 *   is provably nothing to parse. Anything merely IMPERFECT (null bars,
 *   missing adjclose/events) is tolerated instead of throwing.
 */
export function parseYahooChart(payload: unknown, requestedSymbol: string): MarketDataSet {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw new ConnectorError(`Malformed Yahoo payload for '${requestedSymbol}': missing 'chart' object`)
  }
  const chart = payload.chart

  if (chart.error !== undefined && chart.error !== null) {
    const chartError: Record<string, unknown> = isRecord(chart.error) ? chart.error : {}
    const detail = [chartError.code, chartError.description]
      .filter((part): part is string => typeof part === 'string')
      .join(': ')
    throw new ConnectorError(
      `Yahoo chart API error for '${requestedSymbol}': ${detail || 'unknown error'} (symbol not found or delisted?)`,
    )
  }

  if (!Array.isArray(chart.result) || chart.result.length === 0) {
    throw new ConnectorError(`Yahoo chart API returned no data for '${requestedSymbol}' (unknown symbol?)`)
  }
  const result: unknown = chart.result[0]
  if (!isRecord(result)) {
    throw new ConnectorError(`Malformed Yahoo payload for '${requestedSymbol}': empty result entry`)
  }

  const meta: Record<string, unknown> = isRecord(result.meta) ? result.meta : {}
  const gmtOffset = asFiniteNumber(meta.gmtoffset) ?? 0

  if (!Array.isArray(result.timestamp)) {
    throw new ConnectorError(`Malformed Yahoo payload for '${requestedSymbol}': missing timestamp array`)
  }
  const timestamps: unknown[] = result.timestamp

  const indicators: Record<string, unknown> = isRecord(result.indicators) ? result.indicators : {}
  const quotes: unknown = indicators.quote
  const quoteEntry: unknown = Array.isArray(quotes) ? quotes[0] : undefined
  if (!isRecord(quoteEntry)) {
    throw new ConnectorError(`Malformed Yahoo payload for '${requestedSymbol}': missing quote indicators`)
  }
  const adjcloseList: unknown = indicators.adjclose
  const adjcloseEntry: unknown = Array.isArray(adjcloseList) ? adjcloseList[0] : undefined
  const adjcloses: unknown = isRecord(adjcloseEntry) ? adjcloseEntry.adjclose : undefined

  const bars: Bar[] = []
  for (let index = 0; index < timestamps.length; index++) {
    const timestamp = asFiniteNumber(timestamps[index])
    const open = numberAt(quoteEntry.open, index)
    const high = numberAt(quoteEntry.high, index)
    const low = numberAt(quoteEntry.low, index)
    const close = numberAt(quoteEntry.close, index)
    // Null OHLC (halted/suspended sessions): skip the bar, never zero-fill.
    if (
      timestamp === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined
    ) {
      continue
    }
    const bar: Bar = { timestamp: marketDate(timestamp, gmtOffset), open, high, low, close }
    const volume = numberAt(quoteEntry.volume, index)
    if (volume !== undefined) bar.volume = volume
    const adjclose = numberAt(adjcloses, index)
    if (adjclose !== undefined && adjclose > 0 && close > 0) bar.adjustmentFactor = adjclose / close
    bars.push(bar)
  }

  const events: Record<string, unknown> = isRecord(result.events) ? result.events : {}

  const dividends: Dividend[] = []
  if (isRecord(events.dividends)) {
    for (const entry of Object.values(events.dividends)) {
      if (!isRecord(entry)) continue
      const date = asFiniteNumber(entry.date)
      const amount = asFiniteNumber(entry.amount)
      if (date === undefined || amount === undefined) continue
      dividends.push({ exDate: marketDate(date, gmtOffset), amount })
    }
  }

  const splits: Split[] = []
  if (isRecord(events.splits)) {
    for (const entry of Object.values(events.splits)) {
      if (!isRecord(entry)) continue
      const date = asFiniteNumber(entry.date)
      const numerator = asFiniteNumber(entry.numerator)
      const denominator = asFiniteNumber(entry.denominator)
      if (date === undefined || numerator === undefined || denominator === undefined) continue
      splits.push({ exDate: marketDate(date, gmtOffset), numerator, denominator })
    }
  }

  const dataset: MarketDataSet = {
    symbol: typeof meta.symbol === 'string' && meta.symbol.length > 0 ? meta.symbol : requestedSymbol,
    source: 'yahoo',
    bars,
  }
  if (typeof meta.exchangeName === 'string') dataset.exchange = meta.exchangeName
  if (typeof meta.currency === 'string') dataset.currency = meta.currency
  if (dividends.length > 0) dataset.dividends = dividends.sort((a, b) => a.exDate.localeCompare(b.exDate))
  if (splits.length > 0) dataset.splits = splits.sort((a, b) => a.exDate.localeCompare(b.exDate))
  return dataset
}

export const yahoo: Connector = {
  name: 'yahoo',
  requires: 'nothing (keyless)',
  available: () => true,

  async fetchDaily(symbol: string, options: FetchOptions = {}): Promise<MarketDataSet> {
    const range = options.range ?? DEFAULT_RANGE
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${encodeURIComponent(range)}&interval=1d&events=div%2Csplit`

    let payload: unknown
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT },
      })
      if (!response.ok) {
        throw new ConnectorError(`Yahoo chart API returned HTTP ${response.status} for '${symbol}'`)
      }
      payload = await response.json()
    } catch (error) {
      if (error instanceof ConnectorError) throw error
      if (isTimeoutError(error)) {
        throw new ConnectorError(`Yahoo chart request for '${symbol}' aborted: timeout after ${timeoutMs}ms`)
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new ConnectorError(`Yahoo chart request failed for '${symbol}': ${message}`)
    }
    return parseYahooChart(payload, symbol)
  },
}
