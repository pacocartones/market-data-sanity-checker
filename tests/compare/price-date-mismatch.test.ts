import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import type { CompareContext } from '../../src/compare/types'
import { priceDateMismatch } from '../../src/compare/rules/price-date-mismatch'
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
    config: { severity: priceDateMismatch.meta.severity, params: { ...priceDateMismatch.meta.defaultParams } },
    ...buildCompareContext(a, b),
  }
}

const BASE = Array.from({ length: 12 }, (_, i) => 100 + i * 0.1)

describe('PRICE_DATE_MISMATCH', () => {
  it('reports one occurrence per shared date where closes diverge beyond tolerance', () => {
    const broken = [...BASE]
    broken[3] = BASE[3]! * 1.05 // +5% bad print on 2024-01-04
    broken[8] = BASE[8]! * 0.93 // -7% bad print on 2024-01-09
    const a = dataset('yahoo', BASE)
    const b = dataset('other', broken)
    const findings = priceDateMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.where)).toEqual([{ date: '2024-01-04' }, { date: '2024-01-09' }])
    expect(findings[0]).toMatchObject({ rule: 'PRICE_DATE_MISMATCH', severity: 'info' })
    expect(findings[0]!.evidence).toMatchObject({ close_a: BASE[3]!, close_b: broken[3]! })
    expect(findings[0]!.evidence!.divergence_pct).toBeCloseTo(4.762, 3)
  })

  it('stays silent when every shared date is within tolerance', () => {
    const noisy = BASE.map((close, i) => close * (1 + 0.005 * (i % 2 === 0 ? 1 : -1)))
    const a = dataset('yahoo', BASE)
    const b = dataset('other', noisy)
    expect(priceDateMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })

  it('stays silent with too few shared dates', () => {
    const short = BASE.slice(0, 4)
    const shifted = short.map((close) => close * 1.1) // huge gaps, but only 4 shared dates
    const a = dataset('yahoo', short)
    const b = dataset('other', shifted)
    expect(priceDateMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })
})
