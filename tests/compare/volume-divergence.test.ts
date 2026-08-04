import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import type { CompareContext } from '../../src/compare/types'
import { volumeDivergence } from '../../src/compare/rules/volume-divergence'
import { buildCompareContext } from '../../src/compare/engine'

function bars(volumes: Array<number | undefined>, start = '2024-01-01'): Bar[] {
  const result: Bar[] = []
  let cursor = Date.parse(start)
  for (const volume of volumes) {
    const date = new Date(cursor)
    cursor += 24 * 60 * 60 * 1000
    result.push({
      timestamp: date.toISOString().slice(0, 10)!,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume,
    })
  }
  return result
}

function dataset(source: string, volumes: Array<number | undefined>): MarketDataSet {
  return { symbol: 'TEST', source, bars: bars(volumes) }
}

function ctxFor(a: MarketDataSet, b: MarketDataSet): CompareContext {
  return {
    config: { severity: volumeDivergence.meta.severity, params: { ...volumeDivergence.meta.defaultParams } },
    ...buildCompareContext(a, b),
  }
}

const BASE = Array.from({ length: 20 }, () => 1_000_000)

describe('VOLUME_DIVERGENCE', () => {
  it('fires when the median volume ratio exceeds the threshold', () => {
    const quadrupled = BASE.map((volume) => volume * 4.5)
    const a = dataset('yahoo', BASE)
    const b = dataset('other', quadrupled)
    const findings = volumeDivergence.check(a, b, ctxFor(a, b))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'VOLUME_DIVERGENCE', severity: 'info' })
    expect(findings[0]!.evidence).toMatchObject({
      median_volume_ratio: 4.5,
      shared_dates: 20,
      worst_date: '2024-01-01',
      worst_ratio: 4.5,
    })
  })

  it('stays silent when the median ratio is within the threshold', () => {
    const slightlyHigher = BASE.map((volume) => volume * 1.5)
    const a = dataset('yahoo', BASE)
    const b = dataset('other', slightlyHigher)
    expect(volumeDivergence.check(a, b, ctxFor(a, b))).toEqual([])
  })

  it('stays silent with too few shared dates with usable volumes', () => {
    const short = BASE.slice(0, 5)
    const decoupled = short.map((volume) => volume * 10)
    const a = dataset('yahoo', short)
    const b = dataset('other', decoupled)
    expect(volumeDivergence.check(a, b, ctxFor(a, b))).toEqual([])
  })

  it('stays silent when volumes are missing on either side', () => {
    const a = dataset('yahoo', Array.from({ length: 20 }, () => undefined))
    const b = dataset('other', BASE)
    expect(volumeDivergence.check(a, b, ctxFor(a, b))).toEqual([])
  })
})
