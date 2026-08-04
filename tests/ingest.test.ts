import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IngestError, parseMarketDataJson, parseOhlcvCsv } from '../src/ingest/index'
import { normalizeTimestamp } from '../src/ingest/csv'
import { marketDataSetSchema, type MarketDataSet } from '../src/schema/market-data'

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

/** Structural view of the unvalidated ingest output (no `any`). */
interface IngestedDataset {
  bars: Array<Record<string, unknown>>
  [key: string]: unknown
}

function csvRows(rows: string[]): string {
  return ['date,open,high,low,close', ...rows].join('\n')
}

describe('normalizeTimestamp', () => {
  it('normalizes compact YYYYMMDD dates, string or number', () => {
    expect(normalizeTimestamp('20240102')).toBe('2024-01-02')
    expect(normalizeTimestamp(20240102)).toBe('2024-01-02')
  })

  it('normalizes plausible epoch seconds (UTC), string or number', () => {
    expect(normalizeTimestamp(1704153600)).toBe('2024-01-02')
    expect(normalizeTimestamp('1704153600')).toBe('2024-01-02')
    expect(normalizeTimestamp(1000000000)).toBe('2001-09-09') // smallest 10-digit epoch
  })

  it('leaves ISO dates and anything ambiguous untouched', () => {
    expect(normalizeTimestamp('2024-01-02')).toBe('2024-01-02')
    expect(normalizeTimestamp('not-a-date')).toBe('not-a-date')
    expect(normalizeTimestamp('20241301')).toBe('20241301') // month 13 is not a date
    expect(normalizeTimestamp('20240230')).toBe('20240230') // Feb 30 is not a date
    expect(normalizeTimestamp(9999999999)).toBe('9999999999') // year 2286: outside 1990–2100
    expect(normalizeTimestamp(4102444800)).toBe('4102444800') // 2100-01-01: window bound, exclusive
    expect(normalizeTimestamp(1.5)).toBe('1.5')
  })
})

describe('parseOhlcvCsv', () => {
  it('parses a standard OHLCV csv with header aliases', async () => {
    const raw = parseOhlcvCsv(await fixture('ohlcv-valid.csv'), { symbol: 'AAPL', source: 'yahoo' })
    const parsed = marketDataSetSchema.parse(raw) as MarketDataSet
    expect(parsed.symbol).toBe('AAPL')
    expect(parsed.source).toBe('yahoo')
    expect(parsed.bars).toHaveLength(5)
    expect(parsed.bars[0]).toMatchObject({ timestamp: '2024-01-02', close: 185.14, volume: 82488700 })
  })

  it('throws a clear error when required columns are missing', async () => {
    const csv = await fixture('ohlcv-missing-columns.csv')
    expect(() => parseOhlcvCsv(csv)).toThrow(IngestError)
    expect(() => parseOhlcvCsv(csv)).toThrow(/missing required column/i)
  })

  it('normalizes compact, epoch and ISO timestamps in the date column', () => {
    const csv = csvRows(['20240102,100,101,99,100.5', '1704153600,100,101,99,100.5', '2024-01-04,100,101,99,100.5'])
    const raw = parseOhlcvCsv(csv) as IngestedDataset
    expect(raw.bars.map((bar) => bar.timestamp)).toEqual(['2024-01-02', '2024-01-02', '2024-01-04'])
  })

  it('leaves a missing timestamp absent instead of the literal string "undefined"', () => {
    const csv = csvRows([',100,101,99,100.5', '2024-01-03,100,101,99,100.5'])
    const raw = parseOhlcvCsv(csv) as IngestedDataset
    expect(raw.bars).toHaveLength(2)
    expect(raw.bars[0]).not.toHaveProperty('timestamp')
    expect(JSON.stringify(raw)).not.toContain('undefined')
    // And schema validation now blames the real gap, not a fake string.
    expect(marketDataSetSchema.safeParse(raw).success).toBe(false)
  })

  it('throws when more than 10% of rows have a field-count mismatch, naming the first rows', () => {
    const good = '2024-01-02,100,101,99,100.5'
    const rows = Array.from({ length: 10 }, () => good)
    rows[1] = '2024-01-03,100,101,99' // TooFewFields
    rows[4] = '2024-01-06,100,101,99,100.5,extra' // TooManyFields
    const csv = csvRows(rows)
    expect(() => parseOhlcvCsv(csv)).toThrow(IngestError)
    expect(() => parseOhlcvCsv(csv)).toThrow(/structurally broken/)
    expect(() => parseOhlcvCsv(csv)).toThrow(/row 1/)
    expect(() => parseOhlcvCsv(csv)).toThrow(/row 4/)
  })

  it('tolerates a field-count mismatch in at most 10% of rows (deliberately lax)', () => {
    const good = '2024-01-02,100,101,99,100.5'
    const rows = Array.from({ length: 10 }, () => good)
    rows[7] = '2024-01-08,100,101,99' // 1 of 10 = exactly 10%, not more
    const raw = parseOhlcvCsv(csvRows(rows)) as IngestedDataset
    expect(raw.bars).toHaveLength(10)
  })
})

describe('parseMarketDataJson', () => {
  it('wraps a bare array of bars', async () => {
    const raw = parseMarketDataJson(await fixture('bars-array.json'), { symbol: 'AAPL' })
    const parsed = marketDataSetSchema.parse(raw)
    expect(parsed.symbol).toBe('AAPL')
    expect(parsed.source).toBe('json')
    expect(parsed.bars).toHaveLength(2)
  })

  it('preserves a full dataset object including dividends and splits', () => {
    const dataset = {
      symbol: 'MOB.ST',
      source: 'yahoo',
      currency: 'SEK',
      bars: [{ timestamp: '2024-01-02', open: 100, high: 101, low: 99, close: 100 }],
      dividends: [{ exDate: '2024-05-10', amount: 3.5, type: 'regular' }],
      splits: [{ exDate: '2024-06-03', numerator: 2, denominator: 1 }],
    }
    const parsed = marketDataSetSchema.parse(parseMarketDataJson(JSON.stringify(dataset)))
    expect(parsed.dividends).toHaveLength(1)
    expect(parsed.splits).toHaveLength(1)
  })

  it('normalizes compact and epoch bar timestamps in a bare array', () => {
    const bars = [
      { timestamp: 20240102, open: 1, high: 1, low: 1, close: 1 },
      { timestamp: '1704153600', open: 1, high: 1, low: 1, close: 1 },
      { timestamp: '2024-01-04', open: 1, high: 1, low: 1, close: 1 },
    ]
    const raw = parseMarketDataJson(JSON.stringify(bars)) as IngestedDataset
    expect(raw.bars.map((bar) => bar.timestamp)).toEqual(['2024-01-02', '2024-01-02', '2024-01-04'])
  })

  it('normalizes bar timestamps inside a full dataset object without dropping other fields', () => {
    const dataset = {
      symbol: 'X',
      currency: 'USD',
      bars: [{ timestamp: 1704153600, open: 1, high: 1, low: 1, close: 1, volume: 42 }],
    }
    const raw = parseMarketDataJson(JSON.stringify(dataset)) as IngestedDataset
    expect(raw.bars[0]).toMatchObject({ timestamp: '2024-01-02', volume: 42 })
    expect(raw.currency).toBe('USD')
  })

  it('leaves non-bar entries untouched for schema validation to report', () => {
    const bars = [{ open: 1 }, 'garbage', null]
    const raw = parseMarketDataJson(JSON.stringify(bars)) as IngestedDataset
    expect(raw.bars).toEqual([{ open: 1 }, 'garbage', null])
  })

  it('throws on invalid json', () => {
    expect(() => parseMarketDataJson('{not json')).toThrow(IngestError)
  })
})
