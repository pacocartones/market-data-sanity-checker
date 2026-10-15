import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseMarketDataJson, parseOhlcvCsv } from '../../src/ingest'
import { normalizeTimestamp } from '../../src/ingest/timestamps'
import { marketDataSetSchema, type Bar } from '../../src/schema/market-data'
import { isoDay, validBars, validDataset } from './support/arbitraries'
import { check } from './support/config'

/**
 * (g) Ingestion round trips with the real parsers (src/ingest).
 *
 * WHY: ingestion is the trust boundary. A parser that silently rounds a price,
 * drops an optional volume or rewrites a timestamp would corrupt data BEFORE
 * any rule could see it - and no rule can detect that, so only a round-trip
 * property can. JS numbers serialise with `String(n)` / `JSON.stringify` to the
 * shortest string that parses back to the identical double, so equality is exact.
 */

function toCsv(bars: Bar[], style: { header: readonly string[]; eol: string; trailingNewline: boolean }): string {
  const columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const
  const withVolume = bars.some((bar) => bar.volume !== undefined)
  const used = withVolume ? columns : columns.slice(0, 5)
  const header = style.header.slice(0, used.length).join(',')
  const rows = bars.map((bar) => used.map((column) => (bar[column] === undefined ? '' : String(bar[column]))).join(','))
  return [header, ...rows].join(style.eol) + (style.trailingNewline ? style.eol : '')
}

const headerStyles = fc.constantFrom(
  ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
  ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'],
  [' DATE ', 'O', 'H', 'L', 'C', 'V'],
  ['datetime', 'open', 'high', 'low', 'close', 'vol'],
)

describe('(g) ingestion round trips', () => {
  // WHY: any column casing/alias, line ending and optional (partly empty)
  // volume column must give back exactly the bars that were written.
  it('CSV: valid bars survive write -> parseOhlcvCsv -> schema', () => {
    check(
      fc.property(
        validBars({ minBars: 1, maxBars: 40 }),
        headerStyles,
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        (bars, header, eol, trailingNewline) => {
          // The CSV format has no adjustmentFactor column; everything else must round-trip.
          const written = bars.map(({ adjustmentFactor: _factor, ...bar }) => bar)
          const raw = parseOhlcvCsv(toCsv(written, { header, eol, trailingNewline }), { symbol: 'RT', source: 'roundtrip' })
          const parsed = marketDataSetSchema.parse(raw)
          expect(parsed.bars).toEqual(written)
          expect(parsed.symbol).toBe('RT')
          expect(parsed.source).toBe('roundtrip')
        },
      ),
    )
  })

  // WHY: JSON is the lossless path: the full dataset (corporate actions,
  // fundamentals, identifiers, adjustment factors) must come back identical.
  it('JSON: a full dataset survives stringify -> parseMarketDataJson -> schema', () => {
    check(
      fc.property(validDataset({ maxBars: 40 }), fc.constantFrom(undefined, 2, '\t'), (data, indent) => {
        const parsed = marketDataSetSchema.parse(parseMarketDataJson(JSON.stringify(data, null, indent)))
        expect(parsed).toEqual(data)
      }),
    )
  })

  it('JSON: a bare bar array is wrapped with the option symbol/source and keeps its bars', () => {
    check(
      fc.property(validBars({ maxBars: 40, adjustment: true }), (bars) => {
        const raw = parseMarketDataJson(JSON.stringify(bars), { symbol: 'ARR', source: 'array' })
        const parsed = marketDataSetSchema.parse(raw)
        expect(parsed.bars).toEqual(bars)
        expect([parsed.symbol, parsed.source]).toEqual(['ARR', 'array'])
      }),
    )
  })

  // WHY: normalizeTimestamp is documented as conservative: compact YYYYMMDD
  // becomes the ISO date, an ISO date is never touched (idempotent), so a
  // second pass changes nothing.
  it('normalizeTimestamp maps compact dates to ISO, leaves ISO alone and is idempotent', () => {
    check(
      fc.property(fc.integer({ min: Date.UTC(1990, 0, 1) / 86_400_000, max: Date.UTC(2099, 11, 31) / 86_400_000 }), (day) => {
        const iso = isoDay(day * 86_400_000)
        const compact = iso.replaceAll('-', '')
        expect(normalizeTimestamp(compact)).toBe(iso)
        expect(normalizeTimestamp(Number(compact))).toBe(iso)
        expect(normalizeTimestamp(iso)).toBe(iso)
        expect(normalizeTimestamp(normalizeTimestamp(compact))).toBe(iso)
      }),
    )
  })
})
