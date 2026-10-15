import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { runRules } from '../../src/rules/engine'
import { registry } from '../../src/rules/registry'
import type { Finding } from '../../src/report/types'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import { cleanDataset, validDataset } from './support/arbitraries'
import { check } from './support/config'

/**
 * (e) Metamorphic property: multiplying every price by a positive constant.
 *
 * Which rules are scale-invariant (verified by reading src/rules/**):
 *
 * Every rule judges RATIOS of prices (returns, close/previous close,
 * amount/price, high vs low, medians of ratios, Hampel deviation relative to
 * the neighbourhood median) or sign/order/count properties - EXCEPT:
 *
 *   CURRENCY_SUSPECT  absolute threshold: a `.L` series labelled GBP whose
 *                     median close exceeds 500 (`penceMagnitudeThreshold`) is
 *                     "pence-looking". Rescaling prices moves a series across
 *                     that threshold on purpose. This rule is excluded and the
 *                     dependence is pinned by an explicit example below.
 *
 * Money amounts that are compared with prices must be scaled together with
 * them for the corporate/fundamentals rules to stay invariant: dividend
 * `amount` (yield = amount / close), `fundamentals.marketCap` (= shares x
 * close) and `fundamentals.eps` (pe = close / eps). `sharesOutstanding`, `pe`,
 * ratios, factors and split ratios are dimensionless and stay as they are.
 *
 * Exactness: the constant is a power of two, so scaling is exact in IEEE-754
 * (no rounding, no band-edge flips from a 1-ulp difference), and the bars stay
 * far from overflow/underflow. A generic constant would turn this into a flaky
 * test about floating-point noise at thresholds, not about the rules.
 */

const NON_INVARIANT = new Set(['CURRENCY_SUSPECT'])
const INVARIANT_RULES = registry.map((rule) => rule.meta.id).filter((id) => !NON_INVARIANT.has(id))

const scaleFactor = fc.integer({ min: -10, max: 10 }).map((exponent) => 2 ** exponent)

const scaleBar = (bar: Bar, k: number): Bar => ({
  ...bar,
  open: bar.open * k,
  high: bar.high * k,
  low: bar.low * k,
  close: bar.close * k,
})

function scaleBarsOnly(data: MarketDataSet, k: number): MarketDataSet {
  return { ...data, bars: data.bars.map((bar) => scaleBar(bar, k)) }
}

function scaleMoney(data: MarketDataSet, k: number): MarketDataSet {
  const fundamentals = data.fundamentals && {
    ...data.fundamentals,
    ...(data.fundamentals.marketCap !== undefined ? { marketCap: data.fundamentals.marketCap * k } : {}),
    ...(data.fundamentals.eps !== undefined ? { eps: data.fundamentals.eps * k } : {}),
  }
  return {
    ...scaleBarsOnly(data, k),
    ...(data.dividends ? { dividends: data.dividends.map((dividend) => ({ ...dividend, amount: dividend.amount * k })) } : {}),
    ...(fundamentals ? { fundamentals } : {}),
  }
}

/** What must survive the rescaling: which rules fired, how often, how severely and where. */
function signature(findings: Finding[]) {
  return findings
    .filter((finding) => !NON_INVARIANT.has(finding.rule))
    .map(({ rule, severity, action, occurrences, where }) => ({ rule, severity, action, occurrences, date: where?.date }))
}

describe('(e) scale invariance', () => {
  it('lists every rule it exempts as a real registry id', () => {
    for (const id of NON_INVARIANT) expect(registry.map((rule) => rule.meta.id)).toContain(id)
    expect(INVARIANT_RULES.length).toBeGreaterThan(20)
  })

  // WHY: price-only datasets. Scaling bars alone must not change any
  // price-block verdict (returns, spikes, splits, staleness, OHLC logic).
  it('scaling the bars leaves the findings of price-only datasets unchanged', () => {
    check(
      fc.property(validDataset({ maxBars: 40 }), scaleFactor, (data, k) => {
        const priceOnly: MarketDataSet = { symbol: data.symbol, source: data.source, bars: data.bars }
        expect(signature(runRules(scaleBarsOnly(priceOnly, k)))).toEqual(signature(runRules(priceOnly)))
      }),
    )
  })

  // WHY: with dividends, splits, fundamentals and adjustment factors in play,
  // the corporate-action and fundamentals rules compare money amounts with
  // prices; scaling both sides together must leave every verdict unchanged.
  it('scaling bars together with money amounts leaves every non-exempt finding unchanged', () => {
    check(
      fc.property(validDataset({ maxBars: 40 }), scaleFactor, (data, k) => {
        expect(signature(runRules(scaleMoney(data, k)))).toEqual(signature(runRules(data)))
      }),
    )
  })

  // WHY: clean data stays clean at any price level, with an arbitrary (not
  // power-of-two) positive constant: no scale makes a gentle walk critical.
  it('an arbitrary positive constant never makes clean data critical', () => {
    check(
      fc.property(cleanDataset(), fc.double({ min: 0.001, max: 1_000_000, noNaN: true }), (data, k) => {
        const findings = runRules(scaleBarsOnly(data, k))
        expect(findings.filter((finding) => finding.severity === 'critical')).toEqual([])
      }),
    )
  })

  // Pins WHY CURRENCY_SUSPECT is exempt: its verdict depends on the absolute price level.
  it('CURRENCY_SUSPECT is NOT scale-invariant (pence-looking levels on a GBP .L series)', () => {
    const bars: Bar[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: `2024-03-${String(i + 4).padStart(2, '0')}`,
      open: 10, high: 10.2, low: 9.8, close: 10 + (i % 2) * 0.1,
    }))
    const pounds: MarketDataSet = { symbol: 'VOD.L', source: 'test', currency: 'GBP', bars }
    const pence = scaleBarsOnly(pounds, 100)
    const fires = (data: MarketDataSet) => runRules(data).some((finding) => finding.rule === 'CURRENCY_SUSPECT')
    expect(fires(pounds)).toBe(false)
    expect(fires(pence)).toBe(true)
  })
})
