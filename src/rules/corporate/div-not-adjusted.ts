import type { Finding } from '../../report/types'
import { barIndexOnOrBefore, sortedBars } from '../series'
import { median } from '../stats'
import type { Rule } from '../types'

/** How many pre-ex-date bars are sampled when judging the vendor's adjustment. */
const MAX_FACTOR_BARS = 5

/**
 * DIV_NOT_ADJUSTED — a dividend is registered, but the prices before the
 * ex-date show no adjustment (adjustmentFactor ≈ 1).
 *
 * When a vendor properly adjusts for a dividend, every bar before the ex-date
 * carries an adjustmentFactor below 1 by roughly the dividend's yield. The
 * check therefore compares the observed deviation |1 − factor| against the
 * EXPECTED adjustment (dividend / price): fire only when the series is
 * adjusted by less than half of what the dividend requires. A fixed tolerance
 * would false-positive on properly adjusted small dividends — calibration on
 * 50 real Yahoo symbols (2026-07) showed exactly that (AAPL/META/DIA).
 * Documented cases of true non-adjustment: 8TRA.DE and 1398.HK on Yahoo,
 * where Adj Close equals Close before the ex-date. Adjusted close is
 * recalculated retroactively, which silently breaks reproducible backtests.
 *
 * Known limitation (2026-07-31 audit): Yahoo's adjustmentFactor is CUMULATIVE
 * — it folds in every later corporate action, not just the dividend being
 * checked. The expected adjustment (dividend / previous close) therefore only
 * matches the observed factor when this dividend is the last event affecting
 * the series; a dividend left unadjusted but followed by a later, properly
 * adjusted event is masked by that later factor and passes undetected. The
 * rule detects total non-adjustment only, not per-dividend gaps.
 */
export const divNotAdjusted: Rule = {
  meta: {
    id: 'DIV_NOT_ADJUSTED',
    block: 'corporate',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Dividend registered but pre-ex-date prices show far less adjustment than the dividend requires',
    defaultParams: {
      /** Minimum expected adjustment (dividend / price) to evaluate; smaller yields drown in factor noise. */
      minAdjustmentPct: 0.001,
      /** Fire when the observed adjustment is below this fraction of the expected one. */
      underAdjustmentRatio: 0.5,
      /** Minimum number of factored bars before the ex-date required to judge. */
      minBarsBefore: 3,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { minAdjustmentPct, underAdjustmentRatio, minBarsBefore } = context.config.params as {
      minAdjustmentPct: number
      underAdjustmentRatio: number
      minBarsBefore: number
    }
    const findings: Finding[] = []
    const dividends = data.dividends ?? []
    const sorted = sortedBars(data.bars)

    // Without per-bar adjustment factors there is nothing to audit.
    if (!sorted.some((bar) => bar.adjustmentFactor !== undefined)) return findings

    for (const dividend of dividends) {
      if (!(dividend.amount > 0)) continue
      const index = barIndexOnOrBefore(sorted, dividend.exDate)
      if (index < 1) continue

      const previousClose = sorted[index - 1]!.close
      if (!Number.isFinite(previousClose) || previousClose <= 0) continue
      const expectedAdjustment = dividend.amount / previousClose
      // Microscopic dividends: the factor deviation drowns in rounding noise.
      if (expectedAdjustment < minAdjustmentPct) continue

      const factorsBefore: number[] = []
      for (let j = index - 1; j >= 0 && factorsBefore.length < MAX_FACTOR_BARS; j -= 1) {
        const factor = sorted[j]!.adjustmentFactor
        if (factor !== undefined && Number.isFinite(factor)) factorsBefore.push(factor)
      }
      if (factorsBefore.length < minBarsBefore) continue

      const medianFactor = median(factorsBefore)
      const observedAdjustment = 1 - medianFactor
      // Properly adjusted: observed ≈ expected. Fire only when clearly under-adjusted.
      if (observedAdjustment >= underAdjustmentRatio * expectedAdjustment) continue

      findings.push({
        rule: 'DIV_NOT_ADJUSTED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} (ex-date ${dividend.exDate}) implies a ` +
          `${(expectedAdjustment * 100).toFixed(2)}% adjustment of pre-ex-date prices, but the median ` +
          `adjustment factor of the ${factorsBefore.length} session(s) before it is ${medianFactor.toFixed(4)} ` +
          `(observed adjustment ${(observedAdjustment * 100).toFixed(2)}%) — the vendor recorded the dividend ` +
          `without adjusting historical prices (documented cases: 8TRA.DE and 1398.HK on Yahoo, where Adj ` +
          `Close equals Close before the ex-date). Adjusted close is recalculated retroactively, which silently ` +
          `breaks reproducible backtests. Flag and verify against a second source before computing returns.`,
        evidence: {
          median_factor_before: Number(medianFactor.toFixed(6)),
          dividend_amount: dividend.amount,
          expected_adjustment_pct: Number((expectedAdjustment * 100).toFixed(3)),
          observed_adjustment_pct: Number((observedAdjustment * 100).toFixed(3)),
        },
      })
    }

    return findings
  },
}
