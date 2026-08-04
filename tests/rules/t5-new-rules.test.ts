import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { MarketDataSet } from '../../src/schema/market-data'
import type { Rule, RuleContext } from '../../src/rules/types'
import { corpActionMissingFromFactor } from '../../src/rules/corporate/corp-action-missing-from-factor'
import { signValidity } from '../../src/rules/fundamentals/sign-validity'
import { dividendFxMismatch } from '../../src/rules/metadata/dividend-fx-mismatch'

function ctxFor(rule: Rule): RuleContext {
  return {
    config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } },
    profile: { returns: [], medianReturn: 0, madReturn: 0 },
  }
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('CORPORATE_ACTION_MISSING_FROM_FACTOR', () => {
  const ctx = ctxFor(corpActionMissingFromFactor)

  it('flags a persistent factor < 1 with no registered corporate action', async () => {
    const findings = corpActionMissingFromFactor.check(await loadFixture('missing-corp-action-factor.json'), ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'CORPORATE_ACTION_MISSING_FROM_FACTOR',
      severity: 'warning',
      where: { date: '2024-01-02' },
      evidence: { median_factor: 0.97, bars_examined: 10, registered_dividends: 0, registered_splits: 0 },
    })
  })

  it('flags the unexplained stretch after the last registered event', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const midSeriesDividend: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-01-05', amount: 0.5, type: 'regular' }],
    }
    const findings = corpActionMissingFromFactor.check(midSeriesDividend, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      where: { date: '2024-01-08' },
      evidence: { median_factor: 0.97, bars_examined: 6, registered_dividends: 1, registered_splits: 0 },
    })
  })

  it('stays silent without adjustment factors', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const unadjusted: MarketDataSet = {
      ...data,
      bars: data.bars.map((bar) => ({
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })),
    }
    expect(corpActionMissingFromFactor.check(unadjusted, ctx)).toEqual([])
  })

  it('stays silent when the factor is ≈ 1', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const clean: MarketDataSet = {
      ...data,
      bars: data.bars.map((bar) => ({ ...bar, adjustmentFactor: 1 })),
    }
    expect(corpActionMissingFromFactor.check(clean, ctx)).toEqual([])
  })

  it('stays silent when a dividend registered after the bars explains the factor', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const explained: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-01-20', amount: 3.0, type: 'regular' }],
    }
    expect(corpActionMissingFromFactor.check(explained, ctx)).toEqual([])
  })

  it('stays silent when a split registered after the bars explains the factor', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const explained: MarketDataSet = {
      ...data,
      splits: [{ exDate: '2024-01-20', numerator: 2, denominator: 1 }],
    }
    expect(corpActionMissingFromFactor.check(explained, ctx)).toEqual([])
  })

  it('requires at least minBarsAfter factored bars', async () => {
    const data = await loadFixture('missing-corp-action-factor.json')
    const tooFew: MarketDataSet = { ...data, bars: data.bars.slice(0, 2) }
    expect(corpActionMissingFromFactor.check(tooFew, ctx)).toEqual([])
  })
})

describe('FUNDAMENTALS_SIGN_VALIDITY', () => {
  const ctx = ctxFor(signValidity)
  const bars = [
    { timestamp: '2024-03-01', open: 10, high: 10.5, low: 9.5, close: 10, volume: 1000 },
  ]

  it('flags a zero marketCap as critical', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 0, sharesOutstanding: 1_000_000 },
    }
    const findings = signValidity.check(data, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'FUNDAMENTALS_SIGN_VALIDITY',
      severity: 'critical',
      action: 'block',
      where: { date: '2024-03-01' },
      evidence: { marketCap: 0 },
    })
  })

  it('flags a negative marketCap', () => {
    const data: MarketDataSet = { symbol: 'X', source: 'test', bars, fundamentals: { marketCap: -5 } }
    const findings = signValidity.check(data, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'critical', evidence: { marketCap: -5 } })
  })

  it('flags a non-finite marketCap', () => {
    const data: MarketDataSet = { symbol: 'X', source: 'test', bars, fundamentals: { marketCap: Number.NaN } }
    const findings = signValidity.check(data, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'critical', evidence: { marketCap: Number.NaN } })
  })

  it('flags zero sharesOutstanding', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 1_000_000, sharesOutstanding: 0 },
    }
    const findings = signValidity.check(data, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'critical', evidence: { sharesOutstanding: 0 } })
  })

  it('emits one finding per offending field', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: -1, sharesOutstanding: 0 },
    }
    expect(signValidity.check(data, ctx)).toHaveLength(2)
  })

  it('accepts positive finite fundamentals', () => {
    const data: MarketDataSet = {
      symbol: 'X',
      source: 'test',
      bars,
      fundamentals: { marketCap: 1_000_000, sharesOutstanding: 100_000 },
    }
    expect(signValidity.check(data, ctx)).toEqual([])
  })

  it('ignores absent fields and absent fundamentals', () => {
    expect(signValidity.check({ symbol: 'X', source: 'test', bars }, ctx)).toEqual([])
    expect(
      signValidity.check({ symbol: 'X', source: 'test', bars, fundamentals: { eps: 2.5 } }, ctx),
    ).toEqual([])
  })

  it('omits where when the dataset has no bars', () => {
    const data: MarketDataSet = { symbol: 'X', source: 'test', bars: [], fundamentals: { marketCap: 0 } }
    const findings = signValidity.check(data, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.where).toBeUndefined()
  })
})

describe('DIVIDEND_FX_MISMATCH', () => {
  const ctx = ctxFor(dividendFxMismatch)

  it('flags a USD dividend on a GBX series (Shell on the LSE)', async () => {
    const findings = dividendFxMismatch.check(await loadFixture('shell-l-dividend-fx.json'), ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIVIDEND_FX_MISMATCH',
      severity: 'warning',
      where: { date: '2024-02-07' },
      evidence: { dividend_currency: 'USD', series_currency: 'GBX' },
    })
  })

  it('stays silent when dividend and series currency match', async () => {
    const data = await loadFixture('shell-l-dividend-fx.json')
    const aligned: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-02-07', amount: 26.5, currency: 'GBX', type: 'regular' }],
    }
    expect(dividendFxMismatch.check(aligned, ctx)).toEqual([])
  })

  it('deduplicates repeated mismatches of the same currency pair', async () => {
    const data = await loadFixture('shell-l-dividend-fx.json')
    const quarterly: MarketDataSet = {
      ...data,
      dividends: [
        { exDate: '2024-02-07', amount: 0.35, currency: 'USD', type: 'regular' },
        { exDate: '2024-02-13', amount: 0.35, currency: 'USD', type: 'regular' },
      ],
    }
    const findings = dividendFxMismatch.check(quarterly, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ where: { date: '2024-02-07' } })
  })

  it('reports one finding per distinct currency pair', async () => {
    const data = await loadFixture('shell-l-dividend-fx.json')
    const mixed: MarketDataSet = {
      ...data,
      dividends: [
        { exDate: '2024-02-07', amount: 0.35, currency: 'USD', type: 'regular' },
        { exDate: '2024-02-13', amount: 0.3, currency: 'EUR', type: 'regular' },
      ],
    }
    expect(dividendFxMismatch.check(mixed, ctx)).toHaveLength(2)
  })

  it('stays silent without dividends, dividend currency or series currency', async () => {
    expect(dividendFxMismatch.check({ symbol: 'X', source: 'test', bars: [] }, ctx)).toEqual([])

    const data = await loadFixture('shell-l-dividend-fx.json')
    const noSeriesCurrency: MarketDataSet = {
      symbol: data.symbol,
      exchange: data.exchange,
      source: data.source,
      bars: data.bars,
      dividends: data.dividends,
    }
    expect(dividendFxMismatch.check(noSeriesCurrency, ctx)).toEqual([])

    const noDividendCurrency: MarketDataSet = {
      ...data,
      dividends: [{ exDate: '2024-02-07', amount: 0.35, type: 'regular' }],
    }
    expect(dividendFxMismatch.check(noDividendCurrency, ctx)).toEqual([])
  })
})
