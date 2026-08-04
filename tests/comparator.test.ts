import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../src/schema/market-data'
import { compareDatasets } from '../src/compare/comparator'

/**
 * Platform tests for compareDatasets itself (the report builder), as opposed
 * to tests/compare/* which cover individual rules and the alignment engine.
 */

function bar(timestamp: string): Bar {
  return { timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1_000_000 }
}

function dataset(source: string, timestamps: string[], symbol = 'TEST'): MarketDataSet {
  return { symbol, source, bars: timestamps.map(bar) }
}

/** Ten consecutive calendar days — comfortably above the 5-shared-date minimum. */
const TEN_DATES = Array.from({ length: 10 }, (_, i) => `2024-01-${String(i + 2).padStart(2, '0')}`)

describe('compareDatasets', () => {
  it('labels homonymous sources (A)/(B) so only_in keeps both keys', () => {
    const report = compareDatasets(
      dataset('yahoo', ['2024-01-02', '2024-01-03']),
      dataset('yahoo', ['2024-01-03', '2024-01-04']),
    )
    expect(report.sources).toEqual(['yahoo (A)', 'yahoo (B)'])
    expect(report.only_in).toEqual({ 'yahoo (A)': 1, 'yahoo (B)': 1 })
    expect(report.compared_dates).toBe(1)
  })

  it('reports SYMBOL_MISMATCH as critical when the symbols differ', () => {
    const report = compareDatasets(dataset('yahoo', TEN_DATES, 'AAPL'), dataset('stooq', TEN_DATES, 'MSFT'))
    const finding = report.findings.find((entry) => entry.rule === 'SYMBOL_MISMATCH')
    expect(finding?.severity).toBe('critical')
    expect(report.summary.critical).toBeGreaterThan(0)
  })

  it('reports INSUFFICIENT_OVERLAP as critical and docks the score on zero shared dates', () => {
    const report = compareDatasets(
      dataset('yahoo', ['2024-01-02', '2024-01-03']),
      dataset('stooq', ['2024-02-02', '2024-02-03']),
    )
    const finding = report.findings.find((entry) => entry.rule === 'INSUFFICIENT_OVERLAP')
    expect(finding?.severity).toBe('critical')
    expect(report.compared_dates).toBe(0)
    expect(report.consistency_score).toBeLessThan(100)
  })

  it('scores 100 with no findings when identical datasets overlap sufficiently', () => {
    const report = compareDatasets(dataset('yahoo', TEN_DATES), dataset('stooq', TEN_DATES))
    expect(report.findings).toEqual([])
    expect(report.consistency_score).toBe(100)
    expect(report.compared_dates).toBe(TEN_DATES.length)
  })
})
