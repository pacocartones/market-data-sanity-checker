import { describe, expect, it } from 'vitest'
import type { Dividend, MarketDataSet } from '../../src/schema/market-data'
import type { CompareContext } from '../../src/compare/types'
import { dividendMismatch } from '../../src/compare/rules/dividend-mismatch'
import { buildCompareContext } from '../../src/compare/engine'

function dataset(source: string, dividends: Dividend[]): MarketDataSet {
  return { symbol: 'TEST', source, bars: [], dividends }
}

function ctxFor(a: MarketDataSet, b: MarketDataSet): CompareContext {
  return {
    config: { severity: dividendMismatch.meta.severity, params: { ...dividendMismatch.meta.defaultParams } },
    ...buildCompareContext(a, b),
  }
}

describe('DIVIDEND_MISMATCH', () => {
  it('flags dividends missing on either side', () => {
    const a = dataset('yahoo', [{ exDate: '2024-03-15', amount: 0.25 }])
    const b = dataset('other', [{ exDate: '2024-06-10', amount: 0.5 }])
    const findings = dividendMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ rule: 'DIVIDEND_MISMATCH', severity: 'warning', where: { date: '2024-03-15' } })
    expect(findings[0]!.evidence).toMatchObject({ reason: 'missing_in_b', exDate: '2024-03-15', amount_a: 0.25 })
    expect(findings[1]!.evidence).toMatchObject({ reason: 'missing_in_a', exDate: '2024-06-10', amount_b: 0.5 })
  })

  it('flags matched dividends whose amounts differ beyond tolerance', () => {
    const a = dataset('yahoo', [{ exDate: '2024-03-15', amount: 0.25 }])
    const b = dataset('other', [{ exDate: '2024-03-17', amount: 0.3 }]) // same event, 2 days apart
    const findings = dividendMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({
      reason: 'amount_differs',
      exDate: '2024-03-15',
      amount_a: 0.25,
      amount_b: 0.3,
    })
  })

  it('treats dividends outside the match window as missing on both sides', () => {
    const a = dataset('yahoo', [{ exDate: '2024-03-01', amount: 0.25 }])
    const b = dataset('other', [{ exDate: '2024-04-20', amount: 0.25 }]) // 50 days away, beyond the 7-day window
    const findings = dividendMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(2)
    expect(findings[0]!.evidence).toMatchObject({ reason: 'missing_in_b' })
    expect(findings[1]!.evidence).toMatchObject({ reason: 'missing_in_a' })
  })

  it('stays silent when matched dividends agree within tolerance', () => {
    const a = dataset('yahoo', [{ exDate: '2024-03-15', amount: 0.25 }])
    const b = dataset('other', [{ exDate: '2024-03-18', amount: 0.252 }]) // within window, ~0.8% off
    expect(dividendMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })

  it('stays silent when neither source reports dividends', () => {
    const a = dataset('yahoo', [])
    const b = dataset('other', [])
    expect(dividendMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })
})
