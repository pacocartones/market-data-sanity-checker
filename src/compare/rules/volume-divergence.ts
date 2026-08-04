import type { Finding } from '../../report/types'
import { median } from '../../rules/stats'
import type { CompareRule } from '../types'

/**
 * VOLUME_DIVERGENCE — the two sources systematically disagree on volume.
 *
 * Volume is the least portable field across vendors: the documented cases are
 * extreme — Yahoo's own daily volume not matching the sum of its hourly bars,
 * and Excel's STOCKHISTORY differing from Yahoo by up to 2700% on the same
 * symbol. Different venues, consolidation windows and pre-market inclusion
 * make per-date gaps of 2x+ routine between some feed pairs. What this rule
 * flags is the SYSTEMATIC case: the median per-date ratio across shared dates
 * beyond the threshold means the two volume series are simply not comparable
 * — pick one source for volume signals instead of mixing them.
 */
export const volumeDivergence: CompareRule = {
  meta: {
    id: 'VOLUME_DIVERGENCE',
    severity: 'info',
    dimension: 'consistency',
    description: 'Systematic volume disagreement between sources',
    defaultParams: {
      /** Median per-date volume ratio (max/min) above which the sources are deemed incomparable. */
      volumeRatioThreshold: 2,
      /** Minimum shared dates with usable volumes required for the median to be meaningful. */
      minSharedDates: 10,
    },
    references: ['https://quant.stackexchange.com/questions/51072/yahoo-finance-volume-vs-sum-of-hourly-bars'],
  },

  check(a, b, context) {
    const { volumeRatioThreshold, minSharedDates } = context.config.params as {
      volumeRatioThreshold: number
      minSharedDates: number
    }

    const ratios = context.shared
      .map(({ date, a: barA, b: barB }) => {
        if (barA.volume === undefined || barB.volume === undefined) return undefined
        if (!(barA.volume > 0) || !(barB.volume > 0)) return undefined
        return { date, ratio: Math.max(barA.volume, barB.volume) / Math.min(barA.volume, barB.volume) }
      })
      .filter((entry): entry is { date: string; ratio: number } => entry !== undefined)
    if (ratios.length < minSharedDates) return []

    const medianRatio = median(ratios.map((entry) => entry.ratio))
    if (medianRatio <= volumeRatioThreshold) return []

    const worst = ratios.reduce((max, entry) => (entry.ratio > max.ratio ? entry : max))

    const finding: Finding = {
      rule: 'VOLUME_DIVERGENCE',
      severity: context.config.severity,
      action: 'review',
      dimension: 'consistency',
      where: { date: worst.date },
      explanation:
        `${a.source} and ${b.source} report systematically different volumes for ${a.symbol}: median ratio ` +
        `${medianRatio.toFixed(2)}x across ${ratios.length} shared dates (worst: ${worst.ratio.toFixed(2)}x on ` +
        `${worst.date}). Documented cases — Yahoo's daily volume vs the sum of its own hourly bars, or Excel's ` +
        `STOCKHISTORY vs Yahoo with gaps up to 2700% — show volume is often not comparable across feeds ` +
        `(venues, consolidation windows, pre-market inclusion). Use a single source for volume signals.`,
      evidence: {
        median_volume_ratio: Number(medianRatio.toFixed(3)),
        shared_dates: ratios.length,
        worst_date: worst.date,
        worst_ratio: Number(worst.ratio.toFixed(3)),
      },
    }
    return [finding]
  },
}
