import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import { buildCompareContext, dateKey } from '../../src/compare/engine'

function bar(timestamp: string): Bar {
  return { timestamp, open: 100, high: 101, low: 99, close: 100 }
}

function dataset(source: string, timestamps: string[]): MarketDataSet {
  return { symbol: 'TEST', source, bars: timestamps.map(bar) }
}

describe('dateKey', () => {
  it('keeps clean YYYY-MM-DD dates unchanged', () => {
    expect(dateKey('2024-01-02')).toBe('2024-01-02')
  })

  it('normalizes datetimes to their UTC calendar day', () => {
    expect(dateKey('2024-01-02T15:30:00Z')).toBe('2024-01-02')
    expect(dateKey('2024-01-02T00:00:00.000Z')).toBe('2024-01-02')
  })

  it('converts offsets to UTC (documented trade-off: the day can shift)', () => {
    // 2024-01-02 23:00 at -05:00 is 2024-01-03 04:00 UTC.
    expect(dateKey('2024-01-02T23:00:00-05:00')).toBe('2024-01-03')
  })

  it('returns unparseable timestamps raw so they align by exact equality', () => {
    expect(dateKey('garbage')).toBe('garbage')
    expect(dateKey('2024-13-99')).toBe('2024-13-99')
  })
})

describe('buildCompareContext — alignment with heterogeneous formats', () => {
  it('aligns a plain date with the same day expressed as a datetime', () => {
    const alignment = buildCompareContext(dataset('a', ['2024-01-02']), dataset('b', ['2024-01-02T00:00:00.000Z']))
    expect(alignment.shared.map((entry) => entry.date)).toEqual(['2024-01-02'])
    expect(alignment.onlyInA).toEqual([])
    expect(alignment.onlyInB).toEqual([])
  })

  it('aligns identical unparseable timestamps by raw equality', () => {
    const alignment = buildCompareContext(dataset('a', ['garbage']), dataset('b', ['garbage']))
    expect(alignment.shared.map((entry) => entry.date)).toEqual(['garbage'])
    expect(alignment.onlyInA).toEqual([])
    expect(alignment.onlyInB).toEqual([])
  })
})
