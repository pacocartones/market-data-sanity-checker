import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * INSUFFICIENT_DATA — the honesty guard.
 *
 * A trust layer must never certify what it could not evaluate. An empty
 * dataset scores "no findings" by vacuity, and a handful of bars gives the
 * statistical rules nothing to work with — in both cases a high score means
 * absence of evidence, not evidence of quality. This rule says so, loudly:
 * critical on an empty dataset, warning below the minimum for statistics.
 */
export const insufficientData: Rule = {
  meta: {
    id: 'INSUFFICIENT_DATA',
    block: 'price',
    severity: 'warning',
    dimension: 'completeness',
    description: 'Too few bars to evaluate plausibility — the score reflects absence of evidence',
    defaultParams: {
      /** Below this many bars the statistical rules have nothing meaningful to work with. */
      minBars: 10,
    },
    references: [],
  },

  check(data, context) {
    const { minBars } = context.config.params as { minBars: number }
    const count = data.bars.length
    if (count >= minBars) return []

    const findings: Finding[] = [
      {
        rule: 'INSUFFICIENT_DATA',
        // Deliberate escalation: an empty dataset is worse than a small one.
        severity: count === 0 ? 'critical' : context.config.severity,
        action: 'flag',
        dimension: 'completeness',
        explanation:
          count === 0
            ? 'The dataset has no bars at all — nothing was evaluated. A high score here would mean ' +
              'absence of evidence, not evidence of quality. Block this dataset from any downstream use.'
            : `Only ${count} bar(s) provided (minimum for meaningful checks: ${minBars}). The statistical ` +
              `rules (spikes, staleness, splits) have nothing to work with, so this score reflects absence ` +
              `of evidence, not evidence of quality. Fetch more history before trusting the result.`,
        evidence: { bars: count, min_bars: minBars },
      },
    ]
    return findings
  },
}
