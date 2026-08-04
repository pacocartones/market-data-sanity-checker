import { describe, expect, it } from 'vitest'
import type { Bar, MarketDataSet } from '../src/schema/market-data'
import { runRules } from '../src/rules/engine'

/**
 * Calibration guardian: on PLAUSIBLE data the engine must produce zero
 * critical findings. A false positive here fails CI — the tool's own
 * credibility is the product (conservative-threshold principle).
 */

/** Deterministic PRNG (linear congruential) so the walk is stable across runs. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

/** Box–Muller: standard normal from two uniforms. */
function gaussian(random: () => number): number {
  const u1 = Math.max(random(), Number.EPSILON)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Builds a plausible 250-bar random walk on weekdays (drift 0.04%, vol 0.8%). */
function plausibleWalk(seed = 42): MarketDataSet {
  const random = lcg(seed)
  const bars: Bar[] = []
  let close = 100
  let cursor = Date.UTC(2024, 0, 1) // Monday
  while (bars.length < 250) {
    const date = new Date(cursor)
    cursor += 24 * 60 * 60 * 1000
    const day = date.getUTCDay()
    if (day === 0 || day === 6) continue
    const open = close
    close = close * (1 + 0.0004 + 0.008 * gaussian(random))
    bars.push({
      timestamp: date.toISOString().slice(0, 10)!,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1_000_000 + Math.floor(random() * 500_000),
    })
  }
  return { symbol: 'WALK', source: 'synthetic', currency: 'USD', bars }
}

describe('calibration: plausible data yields zero critical findings', () => {
  it('no critical findings on a 250-session random walk', () => {
    const findings = runRules(plausibleWalk())
    expect(findings.filter((f) => f.severity === 'critical')).toEqual([])
  })

  it('no split, bad-tick or structural false positives', () => {
    const rules = runRules(plausibleWalk()).map((f) => f.rule)
    for (const forbidden of [
      'SPLIT_NOT_ADJUSTED',
      'PRICE_SPIKE_INTRADAY',
      'PRICE_NONPOSITIVE',
      'OHLC_INCONSISTENT',
      'CURRENCY_SCALE_SUSPECT',
      'TS_DUPLICATED',
      'BAR_MISSING',
      'STALE_PRICE',
    ]) {
      expect(rules).not.toContain(forbidden)
    }
  })
})

/**
 * Builds the full plausible picture: the random walk plus quarterly regular
 * dividends (payDate after exDate), a properly adjusted 2:1 split (continuous
 * series, split registered), coherent fundamentals and a valid ISIN.
 * A trust layer must have NOTHING to say here — zero findings of any kind.
 */
function plausibleFullDataset(seed = 7): MarketDataSet {
  const walk = plausibleWalk(seed)
  const bars = walk.bars
  const lastClose = bars[bars.length - 1]!.close

  const dividends = []
  for (let index = 60; index < bars.length; index += 63) {
    const exDate = bars[index]!.timestamp
    const payDate = new Date(Date.parse(exDate) + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)!
    dividends.push({ exDate, payDate, amount: 0.5, type: 'regular' as const })
  }

  const sharesOutstanding = 1_000_000_000
  const eps = lastClose / 25 // implies a P/E of exactly 25

  return {
    symbol: 'PLAUSIBLE',
    exchange: 'NASDAQ',
    currency: 'USD',
    source: 'synthetic',
    identifiers: { isin: 'US0378331005' },
    bars,
    dividends,
    splits: [{ exDate: bars[120]!.timestamp, numerator: 2, denominator: 1 }],
    fundamentals: {
      marketCap: sharesOutstanding * lastClose,
      sharesOutstanding,
      eps,
      pe: 25,
      payoutRatio: 0.4,
    },
  }
}

describe('calibration: plausible corporate actions yield ZERO findings', () => {
  it('full plausible dataset (dividends, adjusted split, fundamentals, ISIN) is silent', () => {
    expect(runRules(plausibleFullDataset())).toEqual([])
  })
})
