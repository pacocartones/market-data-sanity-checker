import { describe, expect, it } from 'vitest'
import { barMissing } from '../../src/rules/price/bar-missing'
import { stalePrice } from '../../src/rules/price/stale-price'
import type { Rule, RuleContext } from '../../src/rules/types'
import type { MarketDataSet } from '../../src/schema/market-data'

interface BarInput {
  timestamp: string
  close: number
  volume?: number
}

/** Builds a dataset from { timestamp, close, volume? } triples; OHLC derived from the close. */
function makeDataSet(bars: BarInput[]): MarketDataSet {
  return {
    symbol: 'TEST',
    source: 'synthetic',
    bars: bars.map(({ timestamp, close, volume }) => ({
      timestamp,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      ...(volume !== undefined ? { volume } : {}),
    })),
  }
}

/** Manual context: rules under test import directly, never through the engine. */
function ctxFor(rule: Rule): RuleContext {
  return {
    config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } },
    profile: { returns: [], medianReturn: 0, madReturn: 0 },
  }
}

describe('BAR_MISSING', () => {
  const ctx = ctxFor(barMissing)

  it('flags a gap of a full trading week (5+ missing weekdays)', () => {
    // 2024-01-05 (Fri) → 2024-01-15 (Mon): Jan 8–12 are 5 missing weekdays.
    const findings = barMissing.check(
      makeDataSet([
        { timestamp: '2024-01-05', close: 100 },
        { timestamp: '2024-01-15', close: 101 },
      ]),
      ctx,
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.rule).toBe('BAR_MISSING')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.action).toBe('flag')
    expect(findings[0]!.dimension).toBe('completeness')
    expect(findings[0]!.where).toEqual({ date: '2024-01-15' })
    expect(findings[0]!.evidence).toMatchObject({
      gap_weekdays: 5,
      from: '2024-01-05',
      to: '2024-01-15',
    })
  })

  it('does NOT fire on an ordinary weekend gap', () => {
    const findings = barMissing.check(
      makeDataSet([
        { timestamp: '2024-01-05', close: 100 }, // Friday
        { timestamp: '2024-01-08', close: 101 }, // Monday: 0 weekdays in between
      ]),
      ctx,
    )
    expect(findings).toEqual([])
  })

  it('does NOT fire below the threshold (a long-holiday stretch of 4 weekdays)', () => {
    const findings = barMissing.check(
      makeDataSet([
        { timestamp: '2024-01-05', close: 100 }, // Friday
        { timestamp: '2024-01-12', close: 101 }, // next Friday: 4 weekdays in between
      ]),
      ctx,
    )
    expect(findings).toEqual([])
  })

  it('ignores out-of-order pairs (that is TS_UNORDERED territory)', () => {
    const findings = barMissing.check(
      makeDataSet([
        { timestamp: '2024-01-15', close: 100 },
        { timestamp: '2024-01-05', close: 101 },
      ]),
      ctx,
    )
    expect(findings).toEqual([])
  })

  it('returns [] on degenerate datasets', () => {
    expect(barMissing.check(makeDataSet([]), ctx)).toEqual([])
    expect(barMissing.check(makeDataSet([{ timestamp: '2024-01-02', close: 100 }]), ctx)).toEqual([])
  })
})

describe('STALE_PRICE', () => {
  const ctx = ctxFor(stalePrice)

  it('flags an identical close for 3+ consecutive sessions with trading volume', () => {
    const findings = stalePrice.check(
      makeDataSet([
        { timestamp: '2024-01-02', close: 42, volume: 1000 },
        { timestamp: '2024-01-03', close: 42, volume: 2500 },
        { timestamp: '2024-01-04', close: 42, volume: 800 },
      ]),
      ctx,
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.rule).toBe('STALE_PRICE')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.action).toBe('flag')
    expect(findings[0]!.dimension).toBe('timeliness')
    expect(findings[0]!.where).toEqual({ date: '2024-01-04' })
    expect(findings[0]!.evidence).toMatchObject({
      sessions: 3,
      close: 42,
      from: '2024-01-02',
      to: '2024-01-04',
    })
  })

  it('does NOT fire when every bar of the run has volume 0 (legitimate halt)', () => {
    const findings = stalePrice.check(
      makeDataSet([
        { timestamp: '2024-01-02', close: 42, volume: 0 },
        { timestamp: '2024-01-03', close: 42, volume: 0 },
        { timestamp: '2024-01-04', close: 42, volume: 0 },
      ]),
      ctx,
    )
    expect(findings).toEqual([])
  })

  it('fires when the run has no volume data (absent volume cannot prove a halt)', () => {
    const findings = stalePrice.check(
      makeDataSet([
        { timestamp: '2024-01-02', close: 42 },
        { timestamp: '2024-01-03', close: 42 },
        { timestamp: '2024-01-04', close: 42 },
      ]),
      ctx,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({ sessions: 3, close: 42 })
  })

  it('does NOT fire below the consecutiveSessions threshold', () => {
    const findings = stalePrice.check(
      makeDataSet([
        { timestamp: '2024-01-02', close: 42, volume: 1000 },
        { timestamp: '2024-01-03', close: 42, volume: 1000 },
      ]),
      ctx,
    )
    expect(findings).toEqual([])
  })

  it('reports one finding per run, not per bar', () => {
    const findings = stalePrice.check(
      makeDataSet([
        { timestamp: '2024-01-02', close: 42, volume: 100 },
        { timestamp: '2024-01-03', close: 42, volume: 100 },
        { timestamp: '2024-01-04', close: 42, volume: 100 },
        { timestamp: '2024-01-05', close: 42, volume: 100 },
        { timestamp: '2024-01-08', close: 43, volume: 100 },
        { timestamp: '2024-01-09', close: 44, volume: 100 },
        { timestamp: '2024-01-10', close: 44, volume: 100 },
        { timestamp: '2024-01-11', close: 44, volume: 100 },
      ]),
      ctx,
    )

    expect(findings).toHaveLength(2)
    expect(findings[0]!.where).toEqual({ date: '2024-01-05' })
    expect(findings[0]!.evidence).toMatchObject({ sessions: 4, close: 42 })
    expect(findings[1]!.where).toEqual({ date: '2024-01-11' })
    expect(findings[1]!.evidence).toMatchObject({ sessions: 3, close: 44 })
  })

  it('returns [] on degenerate datasets and never throws on NaN closes', () => {
    expect(stalePrice.check(makeDataSet([]), ctx)).toEqual([])
    expect(stalePrice.check(makeDataSet([{ timestamp: '2024-01-02', close: 42 }]), ctx)).toEqual([])
    expect(
      stalePrice.check(
        makeDataSet([
          { timestamp: '2024-01-02', close: Number.NaN, volume: 100 },
          { timestamp: '2024-01-03', close: Number.NaN, volume: 100 },
          { timestamp: '2024-01-04', close: Number.NaN, volume: 100 },
        ]),
        ctx,
      ),
    ).toEqual([])
  })
})
