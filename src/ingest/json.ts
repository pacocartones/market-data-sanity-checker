import { IngestError, type IngestOptions } from './csv'
import { normalizeTimestamp } from './timestamps'

/**
 * Normalizes the timestamp of every bar-shaped entry (compact YYYYMMDD dates
 * and plausible epoch seconds become ISO calendar dates — same contract as
 * the CSV ingester, shared via ./timestamps). Entries that are not objects
 * with a string/number timestamp pass through untouched: schema validation
 * downstream reports them with a clear message.
 */
function normalizeBarTimestamps(bars: unknown): unknown {
  if (!Array.isArray(bars)) return bars
  return bars.map((bar) => {
    if (typeof bar !== 'object' || bar === null || !('timestamp' in bar)) return bar
    const record = bar as Record<string, unknown>
    const timestamp = record.timestamp
    if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return bar
    return { ...record, timestamp: normalizeTimestamp(timestamp) }
  })
}

/**
 * Parses JSON market data into the canonical dataset shape (unvalidated).
 * Accepts either a full dataset object with a `bars` field, or a bare array
 * of OHLCV bars (wrapped with symbol/source from options). Bar timestamps in
 * compact-date or epoch-seconds form are normalized to ISO calendar dates.
 */
export function parseMarketDataJson(jsonText: string, options: IngestOptions = {}): unknown {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (error) {
    throw new IngestError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (Array.isArray(raw)) {
    return {
      symbol: options.symbol ?? 'UNKNOWN',
      source: options.source ?? 'json',
      bars: normalizeBarTimestamps(raw),
    }
  }

  if (typeof raw === 'object' && raw !== null && 'bars' in raw) {
    const dataset = raw as Record<string, unknown>
    return {
      ...dataset,
      symbol: dataset.symbol ?? options.symbol ?? 'UNKNOWN',
      source: dataset.source ?? options.source ?? 'json',
      bars: normalizeBarTimestamps(dataset.bars),
    }
  }

  throw new IngestError(
    'JSON must be a market data object with a "bars" field or an array of OHLCV bars',
  )
}
