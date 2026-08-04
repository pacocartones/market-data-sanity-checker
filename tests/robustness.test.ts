import { describe, expect, it } from 'vitest'
import type { MarketDataSet } from '../src/schema/market-data'
import { runRules } from '../src/rules/engine'
import { registry } from '../src/rules/registry'

/**
 * Robustness guardian: a trust layer must never crash. Every rule in the
 * corpus runs against degenerate datasets and the engine must survive.
 */

const DEGENERATE_DATASETS: Record<string, MarketDataSet> = {
  'no bars': { symbol: 'X', source: 'test', bars: [] },
  'one bar': {
    symbol: 'X',
    source: 'test',
    bars: [{ timestamp: '2024-01-02', open: 1, high: 1, low: 1, close: 1 }],
  },
  'two bars': {
    symbol: 'X',
    source: 'test',
    bars: [
      { timestamp: '2024-01-02', open: 1, high: 1, low: 1, close: 1 },
      { timestamp: '2024-01-03', open: 1, high: 1, low: 1, close: 1 },
    ],
  },
  'NaN and Infinity values': {
    symbol: 'X',
    source: 'test',
    bars: [
      { timestamp: '2024-01-02', open: Number.NaN, high: Number.POSITIVE_INFINITY, low: 1, close: Number.NaN, volume: Number.NaN },
      { timestamp: '2024-01-03', open: 1, high: 1, low: 1, close: 1 },
    ],
  },
  'no volume at all': {
    symbol: 'X',
    source: 'test',
    bars: [
      { timestamp: '2024-01-02', open: 10, high: 11, low: 9, close: 10.5 },
      { timestamp: '2024-01-03', open: 10.5, high: 11, low: 10, close: 10.8 },
      { timestamp: '2024-01-04', open: 10.8, high: 11, low: 10.5, close: 10.9 },
    ],
  },
  'unordered and duplicated': {
    symbol: 'X',
    source: 'test',
    bars: [
      { timestamp: '2024-01-05', open: 10, high: 11, low: 9, close: 10 },
      { timestamp: '2024-01-03', open: 10, high: 11, low: 9, close: 10 },
      { timestamp: '2024-01-03', open: 10, high: 11, low: 9, close: 10 },
    ],
  },
  'constant series (MAD = 0)': {
    symbol: 'X',
    source: 'test',
    bars: Array.from({ length: 20 }, (_, index) => ({
      timestamp: `2024-02-${String(index + 1).padStart(2, '0')}`,
      open: 42,
      high: 42,
      low: 42,
      close: 42,
      volume: 0,
    })),
  },
  'extreme magnitudes': {
    symbol: 'X',
    source: 'test',
    bars: [
      { timestamp: '2024-01-02', open: 621_000, high: 622_000, low: 620_000, close: 621_000, volume: 1 },
      { timestamp: '2024-01-03', open: 0.000001, high: 0.000002, low: 0.000001, close: 0.0000015, volume: 9_999_999_999 },
    ],
  },
  'corporate actions and metadata degenerate': {
    symbol: 'X',
    source: 'test',
    identifiers: { isin: 'not-an-isin' },
    bars: [{ timestamp: '2024-01-02', open: 1, high: 1, low: 1, close: 1 }],
    dividends: [
      { exDate: 'not-a-date', amount: Number.NaN },
      { exDate: '2024-01-02', payDate: '2024-01-01', amount: -5 },
    ],
    splits: [{ exDate: '2024-01-02', numerator: 1, denominator: 1 }],
    fundamentals: { marketCap: -1, sharesOutstanding: 0, eps: 0, pe: Number.POSITIVE_INFINITY, payoutRatio: Number.NaN },
  },
}

describe('robustness: the engine never crashes', () => {
  for (const [name, dataset] of Object.entries(DEGENERATE_DATASETS)) {
    it(`survives: ${name}`, () => {
      expect(() => runRules(dataset)).not.toThrow()
    })
  }

  it('corpus has 29 rules registered (phases 1+2+4+5)', () => {
    expect(registry).toHaveLength(29)
    expect(new Set(registry.map((rule) => rule.meta.id)).size).toBe(29)
  })

  it('disabling every rule yields zero findings', () => {
    const config = {
      rules: Object.fromEntries(registry.map((rule) => [rule.meta.id, { enabled: false }])),
    }
    for (const dataset of Object.values(DEGENERATE_DATASETS)) {
      expect(runRules(dataset, config)).toEqual([])
    }
  })
})
