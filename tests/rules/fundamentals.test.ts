import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { marketcapMismatch } from '../../src/rules/fundamentals/marketcap-mismatch'
import { peEpsIncompatible } from '../../src/rules/fundamentals/pe-eps-incompatible'
import { payoutImpossible } from '../../src/rules/fundamentals/payout-impossible'

const ctxMarketcap: RuleContext = {
  config: { severity: marketcapMismatch.meta.severity, params: { ...marketcapMismatch.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const ctxPe: RuleContext = {
  config: { severity: peEpsIncompatible.meta.severity, params: { ...peEpsIncompatible.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const ctxPayout: RuleContext = {
  config: { severity: payoutImpossible.meta.severity, params: { ...payoutImpossible.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

const bars = [
  { timestamp: '2024-06-06', open: 99, high: 101, low: 98, close: 100 },
  { timestamp: '2024-06-07', open: 100, high: 102, low: 99, close: 100 },
]

describe('MARKETCAP_MISMATCH', () => {
  it('detects the Alphabet-style wrong market cap', async () => {
    const findings = marketcapMismatch.check(await loadFixture('googl-marketcap-mismatch.json'), ctxMarketcap)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'MARKETCAP_MISMATCH',
      severity: 'warning',
      where: { date: '2024-06-07' },
      evidence: { marketCap: 999000000000, implied_market_cap: 1750000000000, deviation_pct: 75.18 },
    })
  })

  it('accepts a market cap within tolerance', async () => {
    const data = await loadFixture('googl-marketcap-mismatch.json')
    const coherent = { ...data, fundamentals: { marketCap: 1750000000000, sharesOutstanding: 12500000000 } }
    expect(marketcapMismatch.check(coherent, ctxMarketcap)).toEqual([])
  })

  it('handles missing fundamentals and missing bars', () => {
    expect(marketcapMismatch.check({ symbol: 'X', source: 'test', bars }, ctxMarketcap)).toEqual([])
    expect(
      marketcapMismatch.check(
        { symbol: 'X', source: 'test', bars: [], fundamentals: { marketCap: 999000000000, sharesOutstanding: 12500000000 } },
        ctxMarketcap,
      ),
    ).toEqual([])
  })

  it('stays silent at exactly the 5% tolerance edge (the check is <=)', () => {
    // Deviation is |marketCap − implied| / marketCap: 100bn against 95bn
    // implied (950m shares × 100 close) is exactly 5%.
    const atEdge = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 100000000000, sharesOutstanding: 950000000 },
    }
    expect(marketcapMismatch.check(atEdge, ctxMarketcap)).toEqual([])
  })

  it('flags a deviation just above the 5% tolerance', () => {
    const aboveEdge = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 100000000000, sharesOutstanding: 949000000 },
    }
    const findings = marketcapMismatch.check(aboveEdge, ctxMarketcap)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'MARKETCAP_MISMATCH',
      severity: 'warning',
      where: { date: '2024-06-07' },
      evidence: { marketCap: 100000000000, implied_market_cap: 94900000000, deviation_pct: 5.1 },
    })
  })

  it('accepts an 8% deviation under a configured 10% tolerance', () => {
    const customCtx: RuleContext = {
      ...ctxMarketcap,
      config: { ...ctxMarketcap.config, params: { tolerancePct: 0.1 } },
    }
    // 100bn against 92bn implied (920m shares × 100 close) is exactly an 8% deviation.
    const withinCustom = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 100000000000, sharesOutstanding: 920000000 },
    }
    expect(marketcapMismatch.check(withinCustom, customCtx)).toEqual([])
  })
})

describe('PE_EPS_INCOMPATIBLE', () => {
  it('flags a positive P/E with non-positive EPS', () => {
    const findings = peEpsIncompatible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { pe: 25, eps: -1.2 } },
      ctxPe,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PE_EPS_INCOMPATIBLE',
      severity: 'warning',
      where: { date: '2024-06-07' },
      evidence: { pe: 25, eps: -1.2, close: 100, implied_pe: -83.33 },
    })
  })

  it('flags a negative P/E with positive EPS', () => {
    const findings = peEpsIncompatible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { pe: -5, eps: 2 } },
      ctxPe,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PE_EPS_INCOMPATIBLE',
      where: { date: '2024-06-07' },
      evidence: { pe: -5, eps: 2 },
    })
  })

  it('flags a positive P/E with zero EPS', () => {
    const findings = peEpsIncompatible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { pe: 25, eps: 0 } },
      ctxPe,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PE_EPS_INCOMPATIBLE',
      where: { date: '2024-06-07' },
    })
  })

  it('flags a P/E that does not reconcile with close / EPS', () => {
    const findings = peEpsIncompatible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { pe: 25, eps: 2 } },
      ctxPe,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PE_EPS_INCOMPATIBLE',
      where: { date: '2024-06-07' },
      evidence: { pe: 25, eps: 2, close: 100, implied_pe: 50 },
    })
  })

  it('accepts a coherent P/E and the both-negative convention', () => {
    expect(
      peEpsIncompatible.check(
        { symbol: 'X', source: 'test', bars: [{ timestamp: '2024-06-07', open: 49, high: 51, low: 48, close: 50 }], fundamentals: { pe: 25, eps: 2 } },
        ctxPe,
      ),
    ).toEqual([])
    expect(
      peEpsIncompatible.check({ symbol: 'X', source: 'test', bars, fundamentals: { pe: -5, eps: -2 } }, ctxPe),
    ).toEqual([])
  })

  it('handles missing fundamentals and missing bars', () => {
    expect(peEpsIncompatible.check({ symbol: 'X', source: 'test', bars }, ctxPe)).toEqual([])
    expect(
      peEpsIncompatible.check({ symbol: 'X', source: 'test', bars: [], fundamentals: { pe: 25, eps: -1.2 } }, ctxPe),
    ).toEqual([])
  })
})

describe('PAYOUT_IMPOSSIBLE', () => {
  it('flags a negative payout ratio', () => {
    const findings = payoutImpossible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: -0.3 } },
      ctxPayout,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PAYOUT_IMPOSSIBLE',
      severity: 'warning',
      where: { date: '2024-06-07' },
      evidence: { payoutRatio: -0.3 },
    })
  })

  it('flags a payout ratio above 300% of EPS', () => {
    const findings = payoutImpossible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: 3.2 } },
      ctxPayout,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PAYOUT_IMPOSSIBLE',
      where: { date: '2024-06-07' },
      evidence: { payoutRatio: 3.2 },
    })
    expect(findings[0]!.explanation).toContain('REITs and MLPs')
    expect(findings[0]!.explanation).toContain('FFO')
  })

  it('accepts plausible payout ratios, including the REIT/MLP range', () => {
    for (const payoutRatio of [0, 0.85, 1.4, 2.1]) {
      expect(
        payoutImpossible.check({ symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio } }, ctxPayout),
      ).toEqual([])
    }
  })

  it('stays silent at the exact 300% boundary and flags just above it', () => {
    expect(
      payoutImpossible.check({ symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: 3 } }, ctxPayout),
    ).toEqual([])

    const findings = payoutImpossible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: 3.01 } },
      ctxPayout,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PAYOUT_IMPOSSIBLE',
      where: { date: '2024-06-07' },
      evidence: { payoutRatio: 3.01 },
    })
  })

  it('flags payout ratio exceeding a custom maxPayout threshold', () => {
    const customCtx: RuleContext = {
      ...ctxPayout,
      config: { ...ctxPayout.config, params: { maxPayout: 1 } },
    }
    const findings = payoutImpossible.check(
      { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: 1.5 } },
      customCtx,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'PAYOUT_IMPOSSIBLE',
      where: { date: '2024-06-07' },
      evidence: { payoutRatio: 1.5 },
    })
  })

  it('skips non-finite payoutRatio values', () => {
    expect(
      payoutImpossible.check(
        { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: Number.NaN } },
        ctxPayout,
      ),
    ).toEqual([])
    expect(
      payoutImpossible.check(
        { symbol: 'X', source: 'test', bars, fundamentals: { payoutRatio: Number.POSITIVE_INFINITY } },
        ctxPayout,
      ),
    ).toEqual([])
  })

  it('handles missing fundamentals and missing bars', () => {
    expect(payoutImpossible.check({ symbol: 'X', source: 'test', bars }, ctxPayout)).toEqual([])
    expect(
      payoutImpossible.check({ symbol: 'X', source: 'test', bars: [], fundamentals: { payoutRatio: -0.3 } }, ctxPayout),
    ).toEqual([])
  })
})
