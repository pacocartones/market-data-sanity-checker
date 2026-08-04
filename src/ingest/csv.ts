import Papa from 'papaparse'
import { normalizeTimestamp } from './timestamps'

export { normalizeTimestamp }

export class IngestError extends Error {
  override name = 'IngestError'
}

export interface IngestOptions {
  symbol?: string
  source?: string
}

/**
 * Column aliases → canonical bar fields. Headers are lowercased and trimmed
 * before lookup, so `Date`, `DATE`, ` date ` all work.
 */
const COLUMN_ALIASES: Record<string, string> = {
  date: 'timestamp',
  timestamp: 'timestamp',
  time: 'timestamp',
  datetime: 'timestamp',
  open: 'open',
  o: 'open',
  high: 'high',
  h: 'high',
  low: 'low',
  l: 'low',
  close: 'close',
  c: 'close',
  volume: 'volume',
  vol: 'volume',
  v: 'volume',
}

const REQUIRED_FIELDS = ['timestamp', 'open', 'high', 'low', 'close'] as const

/**
 * Share of rows with a field-count mismatch (papaparse TooFewFields /
 * TooManyFields) above which the CSV is treated as structurally broken.
 */
const MAX_FIELD_ERROR_RATIO = 0.1

/**
 * Parses a CSV of OHLCV bars into the canonical dataset shape (unvalidated —
 * schema validation happens downstream, and plausibility is the rules
 * engine's job, not the parser's).
 *
 * Two deliberate decisions (2026-07-31 audit):
 * - Ragged rows: papaparse reports TooFewFields/TooManyFields in
 *   `result.errors`. A few ragged rows are tolerated — the affected fields
 *   simply land missing/undefined and schema validation flags those bars —
 *   but when MORE than 10% of rows have a field-count mismatch the file is
 *   structurally broken (wrong delimiter, shifted columns) and we throw an
 *   IngestError naming the first offending rows instead of ingesting garbage.
 * - Timestamps pass through `normalizeTimestamp`: compact YYYYMMDD dates and
 *   plausible epoch seconds become ISO calendar dates; anything else is kept
 *   raw. A missing timestamp stays ABSENT (never the literal string
 *   'undefined') so schema validation fails with a clear required-field
 *   message pointing at the real gap.
 */
export function parseOhlcvCsv(csvText: string, options: IngestOptions = {}): unknown {
  const result = Papa.parse<Record<string, unknown>>(csvText.trim(), {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  })

  const fields = result.meta.fields ?? []
  if (fields.length === 0 || result.data.length === 0) {
    throw new IngestError('CSV is empty or has no header row')
  }

  const fieldErrors = result.errors.filter((error) => error.type === 'FieldMismatch')
  if (fieldErrors.length > result.data.length * MAX_FIELD_ERROR_RATIO) {
    const details = fieldErrors
      .slice(0, 3)
      .map((error) => `row ${error.row ?? '?'}: ${error.message}`)
      .join('; ')
    throw new IngestError(
      `CSV is structurally broken: ${fieldErrors.length} of ${result.data.length} rows have a field-count mismatch` +
        ` (>${MAX_FIELD_ERROR_RATIO * 100}%). First errors — ${details}`,
    )
  }

  const mapped = fields.map((field) => COLUMN_ALIASES[field] ?? null)
  const missing = REQUIRED_FIELDS.filter((field) => !mapped.includes(field))
  if (missing.length > 0) {
    throw new IngestError(
      `CSV is missing required column(s): ${missing.join(', ')}. Found columns: ${fields.join(', ')}`,
    )
  }

  const bars = result.data.map((row) => {
    const bar: Record<string, unknown> = {}
    fields.forEach((field, index) => {
      const canonical = mapped[index]
      const value = row[field]
      if (canonical && value !== null && value !== undefined && value !== '') {
        bar[canonical] = value
      }
    })
    // Missing timestamps stay absent; normalizeTimestamp never sees them.
    if (bar.timestamp !== undefined && bar.timestamp !== null) {
      bar.timestamp = normalizeTimestamp(bar.timestamp)
    }
    return bar
  })

  return {
    symbol: options.symbol ?? 'UNKNOWN',
    source: options.source ?? 'csv',
    bars,
  }
}
