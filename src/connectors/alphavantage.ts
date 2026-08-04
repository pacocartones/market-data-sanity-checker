import type { Bar, Dividend, MarketDataSet, Split } from '../schema/market-data'
import type { Connector, FetchOptions } from './types'
import { ConnectorError, DEFAULT_TIMEOUT_MS, isTimeoutError } from './types'

/**
 * Alpha Vantage connector — pure parser + thin fetch wrapper.
 *
 * `parseAlphaVantageDaily` is a pure, total function from the provider's JSON
 * payload to the canonical dataset, so it is testable without network access.
 * The `alphaVantage` connector only adds key handling and one fetch call on
 * top. The only throw allowed is ConnectorError: provider-side failures
 * (rate limit, invalid symbol, HTTP errors, network failures) are provider
 * problems, not malformed-data problems, and callers need to tell them apart
 * from rule findings.
 *
 * Notes on the provider:
 * - TIME_SERIES_DAILY_ADJUSTED returns all numeric fields as STRINGS, so
 *   everything goes through explicit Number() parsing with finiteness guards.
 * - The free tier is limited to 25 requests/day; hitting it returns HTTP 200
 *   with a `{ "Note": "..." }` body instead of data — hence the error-key
 *   checks before touching the time series.
 * - The endpoint reports dividend amount and split coefficient per day, which
 *   lets us populate dividends/splits without a second request. It does NOT
 *   report currency or exchange, so those stay undefined (CURRENCY_SUSPECT
 *   will note it as info — correct behaviour, not a gap).
 */

const API_URL = 'https://www.alphavantage.co/query'
const SOURCE = 'alpha-vantage'

/** Provider keys that signal an error payload instead of data. */
const ERROR_KEYS = ['Error Message', 'Note', 'Information'] as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** The API serializes numbers as strings; anything unparsable becomes NaN and is guarded downstream. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return Number.NaN
}

/**
 * Parses a TIME_SERIES_DAILY_ADJUSTED payload into the canonical dataset.
 * Pure and total: throws ConnectorError only on provider error payloads or a
 * missing time series; bars with a non-finite or non-positive close are
 * skipped, never fatal. Bars come back descending from the API and are
 * re-sorted ascending.
 */
export function parseAlphaVantageDaily(payload: unknown, symbol: string): MarketDataSet {
  const root = asRecord(payload)
  if (!root) {
    throw new ConnectorError(`Alpha Vantage response for ${symbol} is not a JSON object`)
  }
  for (const key of ERROR_KEYS) {
    const message = root[key]
    if (typeof message === 'string' && message.length > 0) {
      throw new ConnectorError(`Alpha Vantage returned "${key}" for ${symbol}: ${message}`)
    }
  }

  const series = asRecord(root['Time Series (Daily)'])
  if (!series) {
    throw new ConnectorError(`Alpha Vantage response for ${symbol} has no "Time Series (Daily)" data`)
  }

  const bars: Bar[] = []
  const dividends: Dividend[] = []
  const splits: Split[] = []

  for (const date of Object.keys(series).sort()) {
    const entry = asRecord(series[date])
    if (!entry) continue

    const close = toNumber(entry['4. close'])
    if (!Number.isFinite(close) || close <= 0) continue

    const bar: Bar = {
      timestamp: date,
      open: toNumber(entry['1. open']),
      high: toNumber(entry['2. high']),
      low: toNumber(entry['3. low']),
      close,
    }
    const volume = toNumber(entry['6. volume'])
    if (Number.isFinite(volume)) bar.volume = volume
    const adjustedClose = toNumber(entry['5. adjusted close'])
    if (Number.isFinite(adjustedClose) && adjustedClose > 0) {
      bar.adjustmentFactor = adjustedClose / close
    }
    bars.push(bar)

    const dividendAmount = toNumber(entry['7. dividend amount'])
    if (Number.isFinite(dividendAmount) && dividendAmount > 0) {
      // No `type`: Alpha Vantage does not distinguish regular vs special dividends.
      dividends.push({ exDate: date, amount: dividendAmount })
    }
    const splitCoefficient = toNumber(entry['8. split coefficient'])
    if (Number.isFinite(splitCoefficient) && splitCoefficient > 0 && splitCoefficient !== 1) {
      // Coefficient 2.0 means a 2:1 split, 0.5 a 1:2 reverse split.
      splits.push({ exDate: date, numerator: splitCoefficient, denominator: 1 })
    }
  }

  const dataset: MarketDataSet = { symbol, source: SOURCE, bars }
  if (dividends.length > 0) dataset.dividends = dividends
  if (splits.length > 0) dataset.splits = splits
  return dataset
}

export const alphaVantage: Connector = {
  name: SOURCE,
  requires: 'ALPHA_VANTAGE_API_KEY environment variable (free key at alphavantage.co)',

  available(): boolean {
    return Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  },

  async fetchDaily(symbol: string, options: FetchOptions = {}): Promise<MarketDataSet> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY
    if (!apiKey) {
      throw new ConnectorError(
        'Alpha Vantage requires ALPHA_VANTAGE_API_KEY (free key at alphavantage.co); set it in the environment',
      )
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const url =
      `${API_URL}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}` +
      `&outputsize=full&apikey=${encodeURIComponent(apiKey)}`

    let payload: unknown
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) {
        throw new ConnectorError(`Alpha Vantage HTTP ${response.status} fetching ${symbol}`)
      }
      payload = await response.json()
    } catch (error) {
      if (error instanceof ConnectorError) throw error
      if (isTimeoutError(error)) {
        throw new ConnectorError(`Alpha Vantage request for ${symbol} aborted: timeout after ${timeoutMs}ms`)
      }
      throw new ConnectorError(
        `Alpha Vantage request failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return parseAlphaVantageDaily(payload, symbol)
  },
}
