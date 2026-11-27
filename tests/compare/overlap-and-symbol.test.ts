import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import type { CompareContext, CompareRule } from '../../src/compare/types'
import { insufficientOverlap } from '../../src/compare/rules/insufficient-overlap'
import { symbolMismatch } from '../../src/compare/rules/symbol-mismatch'
import { buildCompareContext } from '../../src/compare/engine'

function bar(date: string, close = 100): Bar {
  return { timestamp: date, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
}

function dates(count: number, start = '2024-01-01'): string[] {
  const out: string[] = []
  let cursor = Date.parse(start)
  for (let i = 0; i < count; i++) {
    out.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += 24 * 60 * 60 * 1000
  }
  return out
}

function dataset(source: string, ds: string[], symbol = 'TEST'): MarketDataSet {
  return { symbol, source, bars: ds.map((d) => bar(d)) }
}

function ctxFor(rule: CompareRule, a: MarketDataSet, b: MarketDataSet, params = {}): CompareContext {
  return {
    config: {
      severity: rule.meta.severity,
      params: { ...rule.meta.defaultParams, ...params },
    },
    ...buildCompareContext(a, b),
  }
}

describe('INSUFFICIENT_OVERLAP', () => {
  it('flags warning on 4 shared dates, stays silent on 5, and flags critical on 0', () => {
    const a4 = dataset('srcA', dates(4))
    const b4 = dataset('srcB', dates(4))
    const f4 = insufficientOverlap.check(a4, b4, ctxFor(insufficientOverlap, a4, b4))
    expect(f4).toHaveLength(1)
    expect(f4[0]).toMatchObject({
      rule: 'INSUFFICIENT_OVERLAP',
      severity: 'warning',
      action: 'flag',
      evidence: { shared_dates: 4 },
    })

    const a5 = dataset('srcA', dates(5))
    const b5 = dataset('srcB', dates(5))
    expect(insufficientOverlap.check(a5, b5, ctxFor(insufficientOverlap, a5, b5))).toEqual([])

    const a0 = dataset('srcA', dates(5, '2024-01-01'))
    const b0 = dataset('srcB', dates(5, '2024-02-01'))
    const f0 = insufficientOverlap.check(a0, b0, ctxFor(insufficientOverlap, a0, b0))
    expect(f0).toHaveLength(1)
    expect(f0[0]).toMatchObject({
      rule: 'INSUFFICIENT_OVERLAP',
      severity: 'critical',
      action: 'block',
      evidence: { shared_dates: 0 },
    })
  })

  it('accepts 2 shared dates when minSharedDates is configured to 2', () => {
    const a2 = dataset('srcA', dates(2))
    const b2 = dataset('srcB', dates(2))
    expect(
      insufficientOverlap.check(a2, b2, ctxFor(insufficientOverlap, a2, b2, { minSharedDates: 2 })),
    ).toEqual([])
  })
})

describe('SYMBOL_MISMATCH', () => {
  it('treats whitespace and case differences as matching', () => {
    const a = dataset('srcA', dates(1), ' aapl ')
    const b = dataset('srcB', dates(1), 'AAPL')
    expect(symbolMismatch.check(a, b, ctxFor(symbolMismatch, a, b))).toEqual([])
  })

  it('flags critical block finding for different symbols', () => {
    const a = dataset('srcA', dates(1), 'AAPL')
    const b = dataset('srcB', dates(1), 'MSFT')
    const findings = symbolMismatch.check(a, b, ctxFor(symbolMismatch, a, b))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SYMBOL_MISMATCH',
      severity: 'critical',
      action: 'block',
      evidence: { symbol_a: 'AAPL', symbol_b: 'MSFT' },
    })
  })
})
