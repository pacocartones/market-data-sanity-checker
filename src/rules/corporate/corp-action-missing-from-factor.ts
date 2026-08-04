import type { Finding } from '../../report/types'
import type { Bar } from '../../schema/market-data'
import { sortedBars } from '../series'
import { median } from '../stats'
import type { Rule } from '../types'

/**
 * CORPORATE_ACTION_MISSING_FROM_FACTOR — the mirror image of DIV_NOT_ADJUSTED:
 * prices ARE adjusted, but no dividend or split is registered to explain it.
 *
 * A bar's adjustmentFactor folds in every corporate action POSTERIOR to it,
 * so bars after the last registered event (or every bar, when nothing is
 * registered) should carry a factor of ≈ 1. A persistent factor below 1 in
 * that stretch means the feed adjusted historical prices for an event it
 * never recorded — silently corrupting raw-price reconstruction and any
 * return series built on adjusted closes.
 */
export const corpActionMissingFromFactor: Rule = {
  meta: {
    id: 'CORPORATE_ACTION_MISSING_FROM_FACTOR',
    block: 'corporate',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Prices adjusted (factor < 1) with no dividend/split registered to explain it',
    defaultParams: {
      /** Deviation below 1 tolerated in the median factor before flagging an unexplained adjustment. */
      factorDeviationTolerance: 0.002,
      /** Minimum number of factored bars in the post-event stretch required to judge. */
      minBarsAfter: 3,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { factorDeviationTolerance, minBarsAfter } = context.config.params as {
      factorDeviationTolerance: number
      minBarsAfter: number
    }
    const findings: Finding[] = []
    const dividends = data.dividends ?? []
    const splits = data.splits ?? []
    const sorted = sortedBars(data.bars)

    // Without per-bar adjustment factors there is nothing to audit.
    if (!sorted.some((bar) => bar.adjustmentFactor !== undefined)) return findings

    // The factor of a bar reflects events posterior to it, so only bars after
    // the LAST registered event are expected to sit at factor ≈ 1.
    let lastEventTime: number | undefined
    for (const exDate of [...dividends.map((dividend) => dividend.exDate), ...splits.map((split) => split.exDate)]) {
      const time = Date.parse(exDate)
      if (Number.isNaN(time)) continue
      if (lastEventTime === undefined || time > lastEventTime) lastEventTime = time
    }

    const stretch: Bar[] = []
    for (const bar of sorted) {
      const factor = bar.adjustmentFactor
      if (factor === undefined || !Number.isFinite(factor)) continue
      if (lastEventTime !== undefined) {
        const time = Date.parse(bar.timestamp)
        if (Number.isNaN(time) || time <= lastEventTime) continue
      }
      stretch.push(bar)
    }
    // The length check alone is not enough: a minBarsAfter of 0 would let an
    // empty stretch through, and the median of nothing is not evidence.
    if (stretch.length === 0 || stretch.length < minBarsAfter) return findings

    const medianFactor = median(stretch.map((bar) => bar.adjustmentFactor!))
    if (medianFactor >= 1 - factorDeviationTolerance) return findings

    const scope =
      lastEventTime === undefined
        ? `the ${stretch.length} factored bars (no dividend or split is registered at all)`
        : `the ${stretch.length} bars after the last registered corporate action ` +
          `(${new Date(lastEventTime).toISOString().slice(0, 10)})`

    findings.push({
      rule: 'CORPORATE_ACTION_MISSING_FROM_FACTOR',
      severity: context.config.severity,
      action: 'flag',
      dimension: 'consistency',
      where: { date: stretch[0]!.timestamp },
      explanation:
        `The median adjustmentFactor of ${scope} is ${medianFactor.toFixed(4)}, below the expected ≈ 1: ` +
        `a bar's adjustmentFactor folds in every LATER dividend or split, so these prices were adjusted ` +
        `for a corporate action the feed never registered. That silently corrupts raw-price reconstruction ` +
        `and any return series built on adjusted closes (documented vendor defect class: yfinance price ` +
        `repair). Register the missing dividend/split from the issuer's corporate-actions calendar, or ` +
        `drop the unexplained adjustment.`,
      evidence: {
        median_factor: Number(medianFactor.toFixed(6)),
        bars_examined: stretch.length,
        registered_dividends: dividends.length,
        registered_splits: splits.length,
      },
    })

    return findings
  },
}
