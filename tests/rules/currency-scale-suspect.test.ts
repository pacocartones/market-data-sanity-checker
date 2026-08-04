import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { marketDataSetSchema, type MarketDataSet } from '../../src/schema/market-data'
import { currencyScaleSuspect } from '../../src/rules/price/currency-scale-suspect'
import type { RuleContext } from '../../src/rules/types'

const ctx: RuleContext = {
  config: {
    severity: currencyScaleSuspect.meta.severity,
    params: { ...currencyScaleSuspect.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadJsonFixture(name: string): Promise<MarketDataSet> {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

/** Builds a series of daily bars from the given closes. */
function seriesFromCloses(closes: number[]): MarketDataSet {
  const start = Date.UTC(2024, 0, 1)
  return {
    symbol: 'TEST',
    source: 'synthetic',
    bars: closes.map((close, index) => {
      const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)!
      return { timestamp: date, open: close, high: close * 1.01, low: close * 0.99, close }
    }),
  }
}

describe('CURRENCY_SCALE_SUSPECT', () => {
  it('flags the AET.L-style pounds→pence block shift exactly once, at the boundary', async () => {
    const data = await loadJsonFixture('aet-l-currency-scale.json')
    const findings = currencyScaleSuspect.check(data, ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.where).toEqual({ date: '2023-09-11' })
    expect(findings[0]!.evidence).toMatchObject({ scale_factor: 100, direction: 'up' })
    expect(findings[0]!.explanation).toMatch(/GBP/)
  })

  it('stays silent on a steady series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i) + 0.0005 * i))
    expect(currencyScaleSuspect.check(seriesFromCloses(closes), ctx)).toEqual([])
  })

  it('stays silent on a one-day spike that reverts (not persistent)', () => {
    const closes = Array.from({ length: 20 }, () => 100)
    closes[10] = 10000 // ×100 for a single session, then back to normal
    expect(currencyScaleSuspect.check(seriesFromCloses(closes), ctx)).toEqual([])
  })

  it('never throws on degenerate datasets', () => {
    expect(currencyScaleSuspect.check(seriesFromCloses([]), ctx)).toEqual([])
    expect(currencyScaleSuspect.check(seriesFromCloses([42]), ctx)).toEqual([])
    expect(currencyScaleSuspect.check(seriesFromCloses([10, Number.NaN, 1000]), ctx)).toEqual([])
  })
})
