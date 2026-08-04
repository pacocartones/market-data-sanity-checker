import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { marketDataSetSchema, type MarketDataSet } from '../../src/schema/market-data'
import { runRules } from '../../src/rules/engine'
import { splitNotAdjusted } from '../../src/rules/price/split-not-adjusted'
import type { RuleContext } from '../../src/rules/types'

export async function loadJsonFixture(name: string): Promise<MarketDataSet> {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('SPLIT_NOT_ADJUSTED', () => {
  it('detects an unadjusted 2:1 split (MOB.ST-style) with a causal hypothesis', async () => {
    const data = await loadJsonFixture('mob-st-unadjusted-split.json')
    const finding = runRules(data).find((f) => f.rule === 'SPLIT_NOT_ADJUSTED')

    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('critical')
    expect(finding!.action).toBe('block')
    expect(finding!.where).toEqual({ date: '2023-04-14' })
    expect(finding!.explanation).toMatch(/2:1 split/)
    expect(finding!.evidence).toMatchObject({ hypothesized_ratio: '2:1' })
    expect(finding!.occurrences).toBe(1)
  })

  it('does not fire when a matching split IS registered', async () => {
    const data = await loadJsonFixture('mob-st-unadjusted-split.json')
    const withSplit = { ...data, splits: [{ exDate: '2023-04-14', numerator: 2, denominator: 1 }] }
    expect(runRules(withSplit).find((f) => f.rule === 'SPLIT_NOT_ADJUSTED')).toBeUndefined()
  })

  it('respects the enabled=false override', async () => {
    const data = await loadJsonFixture('mob-st-unadjusted-split.json')
    const findings = runRules(data, { rules: { SPLIT_NOT_ADJUSTED: { enabled: false } } })
    expect(findings.find((f) => f.rule === 'SPLIT_NOT_ADJUSTED')).toBeUndefined()
  })
})


/** Builds a minimal series from the given closes (2 synthetic days apart is fine: no splits registered). */
function seriesFromCloses(closes: number[]): MarketDataSet {
  const start = Date.UTC(2024, 0, 1)
  return {
    symbol: 'TEST',
    source: 'synthetic',
    bars: closes.map((close, index) => {
      const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)!
      return { timestamp: date, open: close, high: close, low: close, close }
    }),
  }
}

const directCtx: RuleContext = {
  config: {
    severity: splitNotAdjusted.meta.severity,
    params: { ...splitNotAdjusted.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

describe('SPLIT_NOT_ADJUSTED — relative tolerance (2026-07-31 audit fix)', () => {
  it('fires on a 2:1 split that landed on a −5% day (−52.5% observed)', () => {
    // The old absolute ±2pp band stopped at −52% and missed exactly this case.
    const findings = splitNotAdjusted.check(seriesFromCloses([100, 100, 47.5, 47.6]), directCtx)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('critical')
    expect(findings[0]!.explanation).toMatch(/2:1 split/)
    expect(findings[0]!.evidence).toMatchObject({ hypothesized_ratio: '2:1' })
  })

  it('fires on a 20:1 split (−95%) with the right hypothesized ratio', () => {
    const findings = splitNotAdjusted.check(seriesFromCloses([100, 100, 5, 5.01]), directCtx)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({ hypothesized_ratio: '20:1' })
  })

  it('still ignores ordinary moves just outside the band (−53%)', () => {
    expect(splitNotAdjusted.check(seriesFromCloses([100, 100, 47, 47.1]), directCtx)).toEqual([])
  })
})
