import { describe, expect, it } from 'vitest'
import type { MarketDataSet } from '../../src/schema/market-data'
import type { Rule, RuleContext } from '../../src/rules/types'
import { ohlcInconsistent } from '../../src/rules/price/ohlc-inconsistent'
import { priceNonpositive } from '../../src/rules/price/price-nonpositive'
import { volumeNegative } from '../../src/rules/price/volume-negative'

function ctxFor(rule: Rule): RuleContext {
  return {
    config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } },
    profile: { returns: [], medianReturn: 0, madReturn: 0 },
  }
}

function dataset(bars: MarketDataSet['bars']): MarketDataSet {
  return { symbol: 'TEST', source: 'synthetic', bars }
}

const CLEAN_BARS: MarketDataSet['bars'] = [
  { timestamp: '2024-01-02', open: 100, high: 101, low: 99, close: 100.5, volume: 1_000_000 },
  { timestamp: '2024-01-03', open: 100.5, high: 102, low: 100, close: 101.5, volume: 0 },
]

const ALL_RULES = [priceNonpositive, volumeNegative, ohlcInconsistent] as const

describe('PRICE_NONPOSITIVE', () => {
  it('flags every OHLC field that is zero, negative or non-finite', () => {
    const data = dataset([
      { timestamp: '2024-01-02', open: -1, high: 10, low: 9, close: 9.5 },
      { timestamp: '2024-01-03', open: 9.5, high: 10, low: 0, close: Number.NaN },
    ])

    const findings = priceNonpositive.check(data, ctxFor(priceNonpositive))

    expect(findings).toHaveLength(3)
    expect(findings.map((f) => f.evidence)).toEqual([
      { field: 'open', value: -1 },
      { field: 'low', value: 0 },
      { field: 'close', value: Number.NaN },
    ])
    for (const finding of findings) {
      expect(finding.severity).toBe('critical')
      expect(finding.action).toBe('block')
      expect(finding.dimension).toBe('validity')
      expect(finding.explanation).toMatch(/structurally impossible/)
    }
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
  })

  it('returns [] on degenerate datasets (0 and 1 bars)', () => {
    expect(priceNonpositive.check(dataset([]), ctxFor(priceNonpositive))).toEqual([])
    expect(
      priceNonpositive.check(
        dataset([{ timestamp: '2024-01-02', open: 10, high: 10, low: 10, close: 10 }]),
        ctxFor(priceNonpositive),
      ),
    ).toEqual([])
  })
})

describe('VOLUME_NEGATIVE', () => {
  it('flags negative and non-finite volume, but NOT zero or missing volume', () => {
    const data = dataset([
      { timestamp: '2024-01-02', open: 10, high: 10, low: 10, close: 10, volume: -500 },
      { timestamp: '2024-01-03', open: 10, high: 10, low: 10, close: 10, volume: Number.NaN },
      { timestamp: '2024-01-04', open: 10, high: 10, low: 10, close: 10, volume: 0 },
      { timestamp: '2024-01-05', open: 10, high: 10, low: 10, close: 10 },
    ])

    const findings = volumeNegative.check(data, ctxFor(volumeNegative))

    expect(findings).toHaveLength(2)
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
    expect(findings[0]!.evidence).toEqual({ volume: -500 })
    expect(findings[0]!.action).toBe('block')
    expect(findings[1]!.where).toEqual({ date: '2024-01-03' })
  })
})

describe('OHLC_INCONSISTENT', () => {
  it('flags high < low', () => {
    const data = dataset([{ timestamp: '2024-01-02', open: 9.5, high: 9, low: 10, close: 9.5 }])

    const findings = ohlcInconsistent.check(data, ctxFor(ohlcInconsistent))

    const inverted = findings.filter((f) => /High \(9\) is below low \(10\)/.test(f.explanation))
    expect(inverted).toHaveLength(1)
    expect(inverted[0]!.evidence).toEqual({ open: 9.5, high: 9, low: 10, close: 9.5 })
    expect(inverted[0]!.where).toEqual({ date: '2024-01-02' })
    expect(inverted[0]!.action).toBe('block')
  })

  it('flags open and close outside [low, high] (the Yahoo 2020.OL case)', () => {
    const data = dataset([
      { timestamp: '2024-01-02', open: 105, high: 101, low: 99, close: 100.5 },
      { timestamp: '2024-01-03', open: 100.5, high: 101, low: 99, close: 95 },
    ])

    const findings = ohlcInconsistent.check(data, ctxFor(ohlcInconsistent))

    expect(findings).toHaveLength(2)
    expect(findings[0]!.explanation).toMatch(/Open \(105\) lies outside/)
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
    expect(findings[1]!.explanation).toMatch(/Close \(95\) lies outside/)
    expect(findings[1]!.where).toEqual({ date: '2024-01-03' })
  })

  it('skips bars with non-finite fields (PRICE_NONPOSITIVE owns those)', () => {
    const data = dataset([
      { timestamp: '2024-01-02', open: 10, high: Number.NaN, low: 9, close: 9.5 },
    ])
    expect(ohlcInconsistent.check(data, ctxFor(ohlcInconsistent))).toEqual([])
  })
})

describe('clean data', () => {
  it('does not fire any of the three rules (including zero volume)', () => {
    for (const rule of ALL_RULES) {
      expect(rule.check(dataset(CLEAN_BARS), ctxFor(rule))).toEqual([])
    }
  })
})
