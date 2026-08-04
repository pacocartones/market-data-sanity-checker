import type { Finding } from '../../report/types'
import type { CompareRule } from '../types'

/**
 * INSUFFICIENT_OVERLAP — the "agreement on zero evidence" guard.
 *
 * Every compare rule requires a minimum of shared dates, so with too little
 * overlap NOTHING fires and the consistency score is 100 — "both sources
 * agree" over zero evidence, the worst answer a trust layer can give. This
 * rule fires instead: critical on zero shared dates, warning below the
 * minimum for meaningful comparison.
 */
export const insufficientOverlap: CompareRule = {
  meta: {
    id: 'INSUFFICIENT_OVERLAP',
    severity: 'warning',
    dimension: 'completeness',
    description: 'Too few shared dates between sources — agreement cannot be evaluated',
    defaultParams: {
      /** Below this many shared dates, "the sources agree" is not a meaningful claim. */
      minSharedDates: 5,
    },
    references: [],
  },

  check(a, b, context) {
    const { minSharedDates } = context.config.params as { minSharedDates: number }
    const shared = context.shared.length
    if (shared >= minSharedDates) return []

    const findings: Finding[] = [
      {
        rule: 'INSUFFICIENT_OVERLAP',
        // Deliberate escalation: zero overlap means nothing was compared at all.
        severity: shared === 0 ? 'critical' : context.config.severity,
        action: 'flag',
        dimension: 'completeness',
        explanation:
          shared === 0
            ? `${a.source} and ${b.source} share no dates at all for ${a.symbol} — nothing was compared. ` +
              `A perfect consistency score here would be agreement over zero evidence. Check the date ` +
              `ranges, calendars and timestamp formats of both feeds.`
            : `Only ${shared} shared date(s) between ${a.source} and ${b.source} (minimum for a meaningful ` +
              `comparison: ${minSharedDates}). The consistency score reflects absence of evidence, not ` +
              `agreement. Fetch overlapping history before trusting the result.`,
        evidence: {
          shared_dates: shared,
          min_shared_dates: minSharedDates,
          only_in_a: context.onlyInA.length,
          only_in_b: context.onlyInB.length,
        },
      },
    ]
    return findings
  },
}
