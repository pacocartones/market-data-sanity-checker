import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { MarketDataSet } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { divScale100x } from '../../src/rules/corporate/div-scale-100x'
import { divYieldImpossible } from '../../src/rules/corporate/div-yield-impossible'
import { divSpecialMisclassified } from '../../src/rules/corporate/div-special-misclassified'

const scaleCtx: RuleContext = {
  config: { severity: divScale100x.meta.severity, params: { ...divScale100x.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const yieldCtx: RuleContext = {
  config: { severity: divYieldImpossible.meta.severity, params: { ...divYieldImpossible.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const specialCtx: RuleContext = {
  config: {
    severity: divSpecialMisclassified.meta.severity,
    params: { ...divSpecialMisclassified.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

function bar(timestamp: string, close: number) {
  return { timestamp, open: close, high: close, low: close, close }
}

describe('DIV_SCALE_100X', () => {
  it('detects the HLCL.L 100x scale error (pence recorded as pounds)', async () => {
    const findings = divScale100x.check(await loadFixture('hlcl-l-dividend-100x.json'), scaleCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_SCALE_100X',
      severity: 'warning',
      where: { date: '2024-06-10' },
      evidence: { amount: 1.78, prev_close: 1.9 },
    })
    const evidence = findings[0]!.evidence as { single_yield_pct: number; hypothesized_amount: number }
    expect(evidence.single_yield_pct).toBeCloseTo(1.78 / 1.9, 10)
    expect(evidence.hypothesized_amount).toBeCloseTo(0.0178, 10)
  })

  it('degrades a large special dividend (34% of price) to info, without the ×100 hypothesis', async () => {
    const data = await loadFixture('hlcl-l-dividend-100x.json')
    const special: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-06-10', amount: 0.65, type: 'special' }],
    }
    const findings = divScale100x.check(special, scaleCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_SCALE_100X',
      severity: 'info',
      action: 'flag',
      where: { date: '2024-06-10' },
      evidence: { amount: 0.65, prev_close: 1.9 },
    })
    expect(findings[0]!.explanation).toContain('large special dividend')
    expect(findings[0]!.explanation).toContain('ZIM')
    expect(findings[0]!.explanation).not.toContain('×100')
  })

  it('accepts a correctly scaled dividend', async () => {
    const data = await loadFixture('hlcl-l-dividend-100x.json')
    const corrected: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-06-10', amount: 0.0178, type: 'regular' }],
    }
    expect(divScale100x.check(corrected, scaleCtx)).toEqual([])
  })

  it('handles degenerate datasets (no bars, no prior bar, NaN amount)', async () => {
    expect(divScale100x.check({ symbol: 'X', source: 'test', bars: [] }, scaleCtx)).toEqual([])

    const data = await loadFixture('hlcl-l-dividend-100x.json')
    const noPriorBar: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-05-31', amount: 1.78, type: 'regular' }],
    }
    expect(divScale100x.check(noPriorBar, scaleCtx)).toEqual([])

    const nanAmount: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-06-10', amount: Number.NaN, type: 'regular' }],
    }
    expect(divScale100x.check(nanAmount, scaleCtx)).toEqual([])
  })
})

describe('DIV_YIELD_IMPOSSIBLE', () => {
  const data: MarketDataSet = {
    symbol: 'X',
    source: 'test',
    bars: [
      bar('2024-12-27', 7.9),
      bar('2024-12-30', 8.1),
      bar('2024-12-31', 8),
    ],
    dividends: [
      { exDate: '2024-03-15', amount: 0.5, type: 'regular' },
      { exDate: '2024-06-14', amount: 0.5, type: 'regular' },
      { exDate: '2024-09-13', amount: 0.5, type: 'regular' },
      { exDate: '2024-12-13', amount: 0.5, type: 'regular' },
    ],
  }

  it('flags a trailing yield above the plausible bound', () => {
    const findings = divYieldImpossible.check(data, yieldCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_YIELD_IMPOSSIBLE',
      severity: 'warning',
      where: { date: '2024-12-31' },
      evidence: { ttm_dividends: 2, close: 8, ttm_yield_pct: 0.25 },
    })
    expect(findings[0]!.explanation).toContain('almost always a data defect')
    expect(findings[0]!.explanation).toContain('ZIM')
  })

  it('accepts a plausible trailing yield', () => {
    const plausible: MarketDataSet = {
      ...data,
      dividends: data.dividends!.map((dividend) => ({ ...dividend, amount: 0.1 })),
    }
    expect(divYieldImpossible.check(plausible, yieldCtx)).toEqual([])
  })

  it('handles datasets without bars or dividends', () => {
    expect(
      divYieldImpossible.check({ symbol: 'X', source: 'test', bars: [], dividends: data.dividends }, yieldCtx),
    ).toEqual([])
    expect(
      divYieldImpossible.check({ symbol: 'X', source: 'test', bars: data.bars }, yieldCtx),
    ).toEqual([])
  })
})

describe('DIV_SPECIAL_MISCLASSIFIED', () => {
  const regulars = [0.1, 0.1, 0.1, 0.1, 0.1].map((amount, index) => ({
    exDate: ['2023-01-15', '2023-04-15', '2023-07-15', '2023-10-15', '2024-01-15'][index]!,
    amount,
    type: 'regular' as const,
  }))

  it('flags an isolated regular dividend far above the issuer median', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars: [],
      dividends: [...regulars, { exDate: '2024-06-15', amount: 1, type: 'regular' }],
    }
    const findings = divSpecialMisclassified.check(data, specialCtx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_SPECIAL_MISCLASSIFIED',
      severity: 'info',
      where: { date: '2024-06-15' },
      evidence: { amount: 1, peer_median: 0.1, ratio: 10 },
    })
  })

  it('ignores the same payment when tagged special', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars: [],
      dividends: [...regulars, { exDate: '2024-06-15', amount: 1, type: 'special' }],
    }
    expect(divSpecialMisclassified.check(data, specialCtx)).toEqual([])
  })

  it('ignores outliers with a neighbouring dividend inside the isolation window', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars: [],
      dividends: [
        ...regulars,
        { exDate: '2024-06-15', amount: 1, type: 'regular' },
        { exDate: '2024-05-20', amount: 0.05, type: 'special' },
      ],
    }
    expect(divSpecialMisclassified.check(data, specialCtx)).toEqual([])
  })

  it('needs enough peers for a reliable median', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars: [],
      dividends: [...regulars.slice(0, 3), { exDate: '2024-06-15', amount: 1, type: 'regular' }],
    }
    expect(divSpecialMisclassified.check(data, specialCtx)).toEqual([])
  })

  it('handles datasets without dividends', () => {
    expect(divSpecialMisclassified.check({ symbol: 'X', source: 'test', bars: [] }, specialCtx)).toEqual([])
  })
})
