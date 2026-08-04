import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import { tsDuplicated } from '../../src/rules/price/ts-duplicated'
import { tsUnordered } from '../../src/rules/price/ts-unordered'
import { zeroVolumeMoved } from '../../src/rules/price/zero-volume-moved'
import type { Rule, RuleContext } from '../../src/rules/types'

/** Rules are tested in isolation: direct check() call, no engine/registry. */
function ctxFor(rule: Rule): RuleContext {
  return {
    config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } },
    profile: { returns: [], medianReturn: 0, madReturn: 0 },
  }
}

function bar(timestamp: string, overrides: Partial<Bar> = {}): Bar {
  return { timestamp, open: 10, high: 10.5, low: 9.5, close: 10, ...overrides }
}

function dataset(bars: Bar[]): MarketDataSet {
  return { symbol: 'TEST', source: 'synthetic', bars }
}

describe('TS_DUPLICATED', () => {
  const ctx = ctxFor(tsDuplicated)

  it('flags two bars sharing one timestamp, with the count as evidence', () => {
    const findings = tsDuplicated.check(
      dataset([bar('2024-01-02'), bar('2024-01-02'), bar('2024-01-03')]),
      ctx,
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('critical')
    expect(findings[0]!.action).toBe('block')
    expect(findings[0]!.dimension).toBe('uniqueness')
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
    expect(findings[0]!.evidence).toEqual({ count: 2 })
  })

  it('reports one occurrence per duplicated timestamp, however many bars share it', () => {
    const findings = tsDuplicated.check(
      dataset([
        bar('2024-01-02'),
        bar('2024-01-02'),
        bar('2024-01-02'),
        bar('2024-01-05'),
        bar('2024-01-05'),
      ]),
      ctx,
    )

    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.evidence)).toEqual([{ count: 3 }, { count: 2 }])
  })

  it('groups identical unparseable timestamps by their raw string', () => {
    const findings = tsDuplicated.check(dataset([bar('not-a-date'), bar('not-a-date')]), ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.where).toEqual({ date: 'not-a-date' })
    expect(findings[0]!.evidence).toEqual({ count: 2 })
  })

  it('stays silent on unique timestamps and on degenerate datasets', () => {
    expect(tsDuplicated.check(dataset([bar('2024-01-02'), bar('2024-01-03')]), ctx)).toEqual([])
    expect(tsDuplicated.check(dataset([bar('2024-01-02')]), ctx)).toEqual([])
    expect(tsDuplicated.check(dataset([]), ctx)).toEqual([])
  })
})

describe('TS_UNORDERED', () => {
  const ctx = ctxFor(tsUnordered)

  it('flags an adjacent pair that goes backwards in time', () => {
    const findings = tsUnordered.check(
      dataset([bar('2024-01-02'), bar('2024-01-05'), bar('2024-01-03')]),
      ctx,
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.action).toBe('flag')
    expect(findings[0]!.where).toEqual({ date: '2024-01-03' })
    expect(findings[0]!.evidence).toEqual({ previous: '2024-01-05' })
  })

  it('does NOT fire on equal timestamps — that is TS_DUPLICATED', () => {
    expect(tsUnordered.check(dataset([bar('2024-01-02'), bar('2024-01-02')]), ctx)).toEqual([])
  })

  it('skips pairs with unparseable timestamps instead of crashing', () => {
    expect(tsUnordered.check(dataset([bar('oops'), bar('2024-01-02')]), ctx)).toEqual([])
    expect(tsUnordered.check(dataset([bar('2024-01-02'), bar('oops')]), ctx)).toEqual([])
  })

  it('stays silent on ordered data and on degenerate datasets', () => {
    expect(
      tsUnordered.check(dataset([bar('2024-01-02'), bar('2024-01-03'), bar('2024-01-04')]), ctx),
    ).toEqual([])
    expect(tsUnordered.check(dataset([bar('2024-01-02')]), ctx)).toEqual([])
    expect(tsUnordered.check(dataset([]), ctx)).toEqual([])
  })
})

describe('ZERO_VOLUME_MOVED', () => {
  const ctx = ctxFor(zeroVolumeMoved)

  it('flags a zero-volume bar whose price moved intraday', () => {
    const findings = zeroVolumeMoved.check(
      dataset([bar('2024-01-02', { volume: 0, high: 11, low: 9 })]),
      ctx,
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.action).toBe('flag')
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
    expect(findings[0]!.evidence).toEqual({ high: 11, low: 9 })
    expect(findings[0]!.explanation).toMatch(/[Zz]ero volume/)
  })

  it('stays silent when zero volume comes with a flat price (halted instrument)', () => {
    expect(
      zeroVolumeMoved.check(dataset([bar('2024-01-02', { volume: 0, high: 10, low: 10 })]), ctx),
    ).toEqual([])
  })

  it('stays silent when volume is positive or absent', () => {
    expect(
      zeroVolumeMoved.check(dataset([bar('2024-01-02', { volume: 1000, high: 11, low: 9 })]), ctx),
    ).toEqual([])
    expect(zeroVolumeMoved.check(dataset([bar('2024-01-02', { high: 11, low: 9 })]), ctx)).toEqual([])
  })

  it('ignores non-finite prices instead of crashing', () => {
    expect(
      zeroVolumeMoved.check(dataset([bar('2024-01-02', { volume: 0, high: Number.NaN, low: 9 })]), ctx),
    ).toEqual([])
    expect(
      zeroVolumeMoved.check(dataset([bar('2024-01-02', { volume: 0, high: 11, low: Number.NaN })]), ctx),
    ).toEqual([])
  })

  it('stays silent on degenerate datasets', () => {
    expect(zeroVolumeMoved.check(dataset([]), ctx)).toEqual([])
  })
})
