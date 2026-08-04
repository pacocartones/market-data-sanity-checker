import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { marketDataSetSchema, type MarketDataSet } from '../../src/schema/market-data'
import { priceSpikeIntraday } from '../../src/rules/price/price-spike-intraday'
import type { RuleContext } from '../../src/rules/types'

const ctx: RuleContext = {
  config: {
    severity: priceSpikeIntraday.meta.severity,
    params: { ...priceSpikeIntraday.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string): Promise<MarketDataSet> {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

/** Builds a steady series of bars with small daily moves from the given closes. */
function steadySeries(closes: number[]): MarketDataSet {
  const start = Date.UTC(2024, 0, 1)
  return {
    symbol: 'TEST',
    source: 'synthetic',
    bars: closes.map((close, index) => {
      const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)!
      return {
        timestamp: date,
        open: close * 0.999,
        high: close * 1.005,
        low: close * 0.995,
        close,
      }
    }),
  }
}

const STEADY_CLOSES = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i) + 0.0005 * i))

describe('PRICE_SPIKE_INTRADAY', () => {
  it('flags the Berkshire bad tick exactly once, on 2024-06-03', async () => {
    const data = await loadFixture('berkshire-bad-tick.json')
    const findings = priceSpikeIntraday.check(data, ctx)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.rule).toBe('PRICE_SPIKE_INTRADAY')
    expect(findings[0]!.severity).toBe('critical')
    expect(findings[0]!.action).toBe('block')
    expect(findings[0]!.where).toEqual({ date: '2024-06-03' })
    expect(findings[0]!.evidence).toMatchObject({ close: 185.15, reverted_to: 621000 })
    expect(findings[0]!.explanation).toMatch(/bad tick/)
  })

  it('stays silent on a steady series with no spikes', () => {
    expect(priceSpikeIntraday.check(steadySeries(STEADY_CLOSES), ctx)).toEqual([])
  })

  it('does NOT fire on a jump that never reverts (regime change, not a bad tick)', () => {
    const closes = [...STEADY_CLOSES]
    for (let index = 15; index < closes.length; index += 1) closes[index] = closes[index]! * 5
    expect(priceSpikeIntraday.check(steadySeries(closes), ctx)).toEqual([])
  })

  it('returns [] on degenerate datasets instead of throwing', () => {
    expect(priceSpikeIntraday.check(steadySeries([]), ctx)).toEqual([])
    expect(priceSpikeIntraday.check(steadySeries([100]), ctx)).toEqual([])
    expect(priceSpikeIntraday.check(steadySeries([100, Number.NaN, 101]), ctx)).toEqual([])
  })
})
