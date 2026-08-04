import type { Finding } from '../../report/types'
import { median } from '../stats'
import type { Rule } from '../types'

/**
 * CURRENCY_SCALE_SUSPECT — pence/pounds (or cents/dollars) mix-up.
 *
 * The LSE quotes in pence (GBX), so a consumer expecting pounds sees prices
 * ×100 — and vendors sometimes mix scales IN BLOCKS inside a single series
 * (documented cases: AET.L flipping from £ to pence wholesale; HLCL.L/LTI.L
 * dividend scale bugs at 100×). A one-session ×100 jump alone is not enough:
 * the signature that separates a scale bug from a genuine violent move is
 * PERSISTENCE — the median close of the sessions before AND after the
 * boundary must also differ by ~100×, i.e. the level stays displaced instead
 * of snapping back the next day.
 */
export const currencyScaleSuspect: Rule = {
  meta: {
    id: 'CURRENCY_SCALE_SUSPECT',
    block: 'price',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Persistent ~100x price level shift (pence/pounds or cents/dollars confusion)',
    defaultParams: {
      /** Sessions on each side of a boundary whose median close must confirm the scale shift. */
      minRunSessions: 3,
      /** Tolerance around the 100× factor (0.2 ⇒ ratios between 80× and 120× count). */
      scaleTolerance: 0.2,
    },
    references: [
      'https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270',
      'https://ranaroussi.github.io/yfinance/advanced/price_repair.html',
    ],
  },

  check(data, context) {
    const { minRunSessions, scaleTolerance } = context.config.params as {
      minRunSessions: number
      scaleTolerance: number
    }
    const findings: Finding[] = []
    const bars = data.bars

    const upMin = 100 * (1 - scaleTolerance)
    const upMax = 100 * (1 + scaleTolerance)
    const downMin = 1 / upMax
    const downMax = 1 / upMin

    const closes = bars.map((bar) => bar.close)
    /** Median of the finite, positive closes in [from, to); undefined when none are usable. */
    const windowMedian = (from: number, to: number): number | undefined => {
      const valid = closes.slice(from, to).filter((close) => Number.isFinite(close) && close > 0)
      return valid.length > 0 ? median(valid) : undefined
    }

    for (let index = 0; index < bars.length - 1; index += 1) {
      const previous = bars[index]!
      const current = bars[index + 1]!
      if (!Number.isFinite(previous.close) || !Number.isFinite(current.close)) continue
      if (previous.close <= 0 || current.close <= 0) continue

      const ratio = current.close / previous.close
      const direction =
        ratio >= upMin && ratio <= upMax ? 'up' : ratio >= downMin && ratio <= downMax ? 'down' : undefined
      if (direction === undefined) continue

      // A one-day spike that reverts also crosses a ~100× boundary — only flag
      // when the median level on each side differs by the same ~100× factor.
      const medianBefore = windowMedian(Math.max(0, index + 1 - minRunSessions), index + 1)
      const medianAfter = windowMedian(index + 1, index + 1 + minRunSessions)
      if (medianBefore === undefined || medianAfter === undefined || medianBefore <= 0) continue
      const medianRatio = medianAfter / medianBefore
      const persists =
        direction === 'up'
          ? medianRatio >= upMin && medianRatio <= upMax
          : medianRatio >= downMin && medianRatio <= downMax
      if (!persists) continue

      const scaleFactor = Number(ratio.toFixed(1))
      findings.push({
        rule: 'CURRENCY_SCALE_SUSPECT',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: current.timestamp },
        explanation:
          `Price level shifted ~${scaleFactor}× ${direction} at this date and stayed there ` +
          `(median close ${medianBefore.toFixed(4)} before vs ${medianAfter.toFixed(4)} after), ` +
          `so this is a persistent scale change, not a one-session move. Hypothesis: the feed mixes price scales ` +
          `in blocks — pence vs pounds (GBX vs GBP) or cents vs dollars, a documented vendor defect on LSE symbols. ` +
          `Verify the currency the instrument actually trades in at the source` +
          (data.currency ? ` (this series is labelled ${data.currency})` : '') +
          ` and rescale one of the blocks.`,
        evidence: {
          scale_factor: scaleFactor,
          direction,
          median_before: Number(medianBefore.toFixed(4)),
          median_after: Number(medianAfter.toFixed(4)),
        },
      })
    }

    return findings
  },
}
