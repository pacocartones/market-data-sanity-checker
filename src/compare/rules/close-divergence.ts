import type { Finding } from '../../report/types'
import { median } from '../../rules/stats'
import type { CompareRule } from '../types'

/**
 * CLOSE_DIVERGENCE — the two sources systematically disagree on the close.
 *
 * Small per-date differences are normal (venues, snapshots, adjustment
 * timing). What matters is a SYSTEMATIC gap: the median daily divergence
 * across all shared dates beyond 0.5% means the feeds are not telling the
 * same story — typically different adjustment policies, different venues, or
 * a currency/scale mismatch. Documented systematically by Kibot against
 * Yahoo/Bloomberg, and by definition differences like fully-diluted vs basic
 * shares (MSTR on Yahoo).
 */
export const closeDivergence: CompareRule = {
  meta: {
    id: 'CLOSE_DIVERGENCE',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Systematic close divergence between two sources across shared dates',
    defaultParams: {
      /** Median daily divergence (fraction) above which the sources systematically disagree. */
      medianTolerancePct: 0.005,
      /** Minimum shared dates required for the median to be meaningful. */
      minSharedDates: 10,
    },
    references: ['https://www.kibot.com/quality/data-comparison.html'],
  },

  check(a, b, context) {
    const { medianTolerancePct, minSharedDates } = context.config.params as {
      medianTolerancePct: number
      minSharedDates: number
    }
    if (context.shared.length < minSharedDates) return []

    const divergences = context.shared
      .map(({ date, a: barA, b: barB }) => {
        if (!(barA.close > 0) || !(barB.close > 0)) return undefined
        return { date, divergence: Math.abs(barA.close - barB.close) / Math.max(barA.close, barB.close) }
      })
      .filter((entry): entry is { date: string; divergence: number } => entry !== undefined)
    if (divergences.length < minSharedDates) return []

    const medianDivergence = median(divergences.map((entry) => entry.divergence))
    if (medianDivergence <= medianTolerancePct) return []

    const worst = divergences.reduce((max, entry) => (entry.divergence > max.divergence ? entry : max))

    const finding: Finding = {
      rule: 'CLOSE_DIVERGENCE',
      severity: context.config.severity,
      action: 'flag',
      dimension: 'consistency',
      where: { date: worst.date },
      explanation:
        `${a.source} and ${b.source} disagree on ${a.symbol} closes by a median of ` +
        `${(medianDivergence * 100).toFixed(2)}% across ${divergences.length} shared dates ` +
        `(worst: ${(worst.divergence * 100).toFixed(2)}% on ${worst.date}). Systematic divergence usually means ` +
        `different adjustment policies, different venues, or a currency/scale mismatch — reconcile before ` +
        `mixing the feeds in one pipeline.`,
      evidence: {
        median_divergence_pct: Number((medianDivergence * 100).toFixed(3)),
        shared_dates: divergences.length,
        worst_date: worst.date,
        worst_divergence_pct: Number((worst.divergence * 100).toFixed(3)),
      },
    }
    return [finding]
  },
}
