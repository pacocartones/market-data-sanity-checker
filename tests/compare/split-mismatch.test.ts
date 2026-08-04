import { describe, expect, it } from 'vitest'
import type { MarketDataSet, Split } from '../../src/schema/market-data'
import type { CompareContext } from '../../src/compare/types'
import { splitMismatch } from '../../src/compare/rules/split-mismatch'
import { buildCompareContext } from '../../src/compare/engine'

function dataset(source: string, splits: Split[]): MarketDataSet {
  return { symbol: 'TEST', source, bars: [], splits }
}

function ctxFor(a: MarketDataSet, b: MarketDataSet): CompareContext {
  return {
    config: { severity: splitMismatch.meta.severity, params: { ...splitMismatch.meta.defaultParams } },
    ...buildCompareContext(a, b),
  }
}

describe('SPLIT_MISMATCH', () => {
  it('flags a split missing from the other source', () => {
    const a = dataset('yahoo', [{ exDate: '2024-06-07', numerator: 2, denominator: 1 }])
    const b = dataset('other', [])
    const findings = splitMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'SPLIT_MISMATCH', severity: 'warning', where: { date: '2024-06-07' } })
    expect(findings[0]!.evidence).toMatchObject({ reason: 'missing_in_b', exDate: '2024-06-07', ratio_a: 2 })
  })

  it('flags matched splits whose ratios differ beyond tolerance', () => {
    const a = dataset('yahoo', [{ exDate: '2024-06-07', numerator: 2, denominator: 1 }]) // ratio 2
    const b = dataset('other', [{ exDate: '2024-06-08', numerator: 3, denominator: 2 }]) // ratio 1.5, 1 day apart
    const findings = splitMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({
      reason: 'ratio_differs',
      exDate: '2024-06-07',
      ratio_a: 2,
      ratio_b: 1.5,
    })
  })

  it('treats splits outside the match window as missing on both sides', () => {
    const a = dataset('yahoo', [{ exDate: '2024-06-01', numerator: 2, denominator: 1 }])
    const b = dataset('other', [{ exDate: '2024-07-15', numerator: 2, denominator: 1 }]) // 44 days away
    const findings = splitMismatch.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(2)
    expect(findings[0]!.evidence).toMatchObject({ reason: 'missing_in_b' })
    expect(findings[1]!.evidence).toMatchObject({ reason: 'missing_in_a' })
  })

  it('stays silent on the same ratio expressed with different numerators', () => {
    const a = dataset('yahoo', [{ exDate: '2024-06-07', numerator: 2, denominator: 1 }])
    const b = dataset('other', [{ exDate: '2024-06-09', numerator: 4, denominator: 2 }]) // same 2:1 event
    expect(splitMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })

  it('stays silent when neither source reports splits', () => {
    const a = dataset('yahoo', [])
    const b = dataset('other', [])
    expect(splitMismatch.check(a, b, ctxFor(a, b))).toEqual([])
  })
})
