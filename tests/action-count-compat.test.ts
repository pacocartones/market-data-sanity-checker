import { describe, expect, it } from 'vitest'
import { marketDataSetSchema } from '../src/schema/market-data'
import { checkMarketData } from '../src/checker'
import { compareDatasets } from '../src/compare/comparator'
import { divDuplicated } from '../src/rules/corporate/div-duplicated'

function actionDates() {
  return Array.from({ length: 513 }, (_, index) =>
    new Date(Date.UTC(2023, 0, index * 8 + 1)).toISOString().slice(0, 10))
}

describe('1.x corporate action compatibility', () => {
  it('accepts 513 valid dividends and splits and checks the full input', () => {
    const dates = actionDates()
    const raw = {
      symbol: 'TEST', source: 'synthetic', bars: [],
      dividends: dates.map((exDate, index) => ({ exDate, amount: index + 1 })),
      splits: dates.map((exDate) => ({ exDate, numerator: 2, denominator: 1 })),
    }
    const parsed = marketDataSetSchema.parse(raw)
    expect(parsed.dividends).toHaveLength(513)
    expect(parsed.splits).toHaveLength(513)
    expect(divDuplicated.check(parsed, {
      config: { severity: 'warning', params: { ...divDuplicated.meta.defaultParams } },
      profile: { returns: [], medianReturn: 0, madReturn: 0 },
    })).toEqual([])
    const report = checkMarketData(parsed)
    expect(report.findings.some((finding) => finding.rule === 'SCHEMA_INVALID')).toBe(false)
    expect(report.symbol).toBe('TEST')
  })

  it('compares all 513 dividends, including the last one', () => {
    const dates = actionDates()
    const first = marketDataSetSchema.parse({
      symbol: 'TEST', source: 'first', bars: [],
      dividends: dates.map((exDate, index) => ({ exDate, amount: index + 1 })),
    })
    const second = marketDataSetSchema.parse({
      ...first, source: 'second',
      dividends: first.dividends!.map((dividend, index) =>
        index === 512 ? { ...dividend, amount: 1026 } : dividend),
    })
    const report = compareDatasets(first, second)
    expect(report.consistency_score).toBe(45) // one warning and the no-bars completeness finding
    expect(report.summary.warning).toBe(1)
    expect(report.summary.critical).toBe(1)
    expect(report.findings.find((finding) => finding.rule === 'DIVIDEND_MISMATCH')).toMatchObject({
      occurrences: 1,
      where: { date: dates[512] },
      evidence: { reason: 'amount_differs', amount_a: 513, amount_b: 1026 },
    })
  })

  it('compares all 513 splits, including the last one', () => {
    const dates = actionDates()
    const first = marketDataSetSchema.parse({
      symbol: 'TEST', source: 'first', bars: [],
      splits: dates.map((exDate) => ({ exDate, numerator: 2, denominator: 1 })),
    })
    const second = marketDataSetSchema.parse({
      ...first, source: 'second',
      splits: first.splits!.map((split, index) =>
        index === 512 ? { ...split, numerator: 3 } : split),
    })
    const report = compareDatasets(first, second)
    expect(report.findings.find((finding) => finding.rule === 'SPLIT_MISMATCH')).toMatchObject({
      occurrences: 1,
      where: { date: dates[512] },
      evidence: { reason: 'ratio_differs', ratio_a: 2, ratio_b: 3 },
    })
  })
})
