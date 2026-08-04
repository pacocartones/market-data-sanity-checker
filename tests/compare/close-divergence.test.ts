import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import type { CompareContext } from '../../src/compare/types'
import { closeDivergence } from '../../src/compare/rules/close-divergence'
import { buildCompareContext } from '../../src/compare/engine'

function bars(closes: number[], start = '2024-01-01'): Bar[] {
  const result: Bar[] = []
  let cursor = Date.parse(start)
  for (const close of closes) {
    const date = new Date(cursor)
    cursor += 24 * 60 * 60 * 1000
    result.push({
      timestamp: date.toISOString().slice(0, 10)!,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    })
  }
  return result
}

function dataset(source: string, closes: number[]): MarketDataSet {
  return { symbol: 'TEST', source, bars: bars(closes) }
}

function ctxFor(a: MarketDataSet, b: MarketDataSet): CompareContext {
  return {
    config: { severity: closeDivergence.meta.severity, params: { ...closeDivergence.meta.defaultParams } },
    ...buildCompareContext(a, b),
  }
}

const BASE = Array.from({ length: 20 }, (_, i) => 100 + i * 0.1)

describe('CLOSE_DIVERGENCE', () => {
  it('fires when sources systematically diverge beyond the median tolerance', () => {
    const shifted = BASE.map((close) => close * 1.02) // 2% systematic gap
    const findings = closeDivergence.check(dataset('yahoo', BASE), dataset('other', shifted), ctxFor(dataset('yahoo', BASE), dataset('other', shifted)))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'CLOSE_DIVERGENCE', severity: 'warning' })
    expect(findings[0]!.evidence).toMatchObject({ shared_dates: 20 })
  })

  it('stays silent on tiny per-date noise', () => {
    const noisy = BASE.map((close, i) => close * (1 + 0.001 * (i % 2 === 0 ? 1 : -1)))
    expect(closeDivergence.check(dataset('yahoo', BASE), dataset('other', noisy), ctxFor(dataset('yahoo', BASE), dataset('other', noisy)))).toEqual([])
  })

  it('stays silent with too few shared dates', () => {
    const short = BASE.slice(0, 5)
    expect(
      closeDivergence.check(dataset('yahoo', short), dataset('other', short), ctxFor(dataset('yahoo', short), dataset('other', short))),
    ).toEqual([])
  })
})

describe('buildCompareContext', () => {
  it('aligns bars by date and reports exclusive dates', () => {
    const a = dataset('yahoo', BASE)
    const b: MarketDataSet = { symbol: 'TEST', source: 'other', bars: bars(BASE.slice(2), '2024-01-03') }
    const alignment = buildCompareContext(a, b)
    expect(alignment.shared).toHaveLength(18)
    expect(alignment.onlyInA).toEqual(['2024-01-01', '2024-01-02'])
    expect(alignment.onlyInB).toEqual([])
  })
})
