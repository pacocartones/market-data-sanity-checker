import type { Finding } from '../../report/types'
import type { CompareRule } from '../types'

/**
 * PRICE_DATE_MISMATCH — specific shared dates where the two sources disagree
 * on the close beyond tolerance.
 *
 * Unlike CLOSE_DIVERGENCE (a systematic gap across the whole overlap), this
 * rule catches ISOLATED bad sessions: one feed prints a wrong close for a
 * single day while agreeing everywhere else. Kibot documents exactly this
 * failure mode when comparing vendors — punctual bad prints, not a different
 * adjustment policy. One occurrence per offending date; the recommended move
 * is to verify that session against a third source.
 */
export const priceDateMismatch: CompareRule = {
  meta: {
    id: 'PRICE_DATE_MISMATCH',
    severity: 'info',
    dimension: 'consistency',
    description: 'Specific shared dates where the two sources disagree on the close beyond tolerance',
    defaultParams: {
      /** Per-date close divergence (fraction) above which that session is flagged. */
      dateTolerancePct: 0.02,
      /** Minimum shared dates required before per-date mismatches are reported. */
      minSharedDates: 5,
    },
    references: ['https://www.kibot.com/quality/data-comparison.html'],
  },

  check(a, b, context) {
    const { dateTolerancePct, minSharedDates } = context.config.params as {
      dateTolerancePct: number
      minSharedDates: number
    }
    if (context.shared.length < minSharedDates) return []

    const findings: Finding[] = []
    for (const { date, a: barA, b: barB } of context.shared) {
      if (!(barA.close > 0) || !(barB.close > 0)) continue
      const divergence = Math.abs(barA.close - barB.close) / Math.max(barA.close, barB.close)
      if (divergence <= dateTolerancePct) continue
      findings.push({
        rule: 'PRICE_DATE_MISMATCH',
        severity: context.config.severity,
        action: 'review',
        dimension: 'consistency',
        where: { date },
        explanation:
          `${a.source} and ${b.source} disagree on the ${a.symbol} close on ${date}: ` +
          `${barA.close} vs ${barB.close} (${(divergence * 100).toFixed(2)}% apart). An isolated per-date gap ` +
          `this size — while the feeds agree elsewhere — is typically a bad print from one of the two, a ` +
          `failure mode Kibot documents when comparing vendors. Verify that session against a third source ` +
          `before trusting either close.`,
        evidence: {
          close_a: barA.close,
          close_b: barB.close,
          divergence_pct: Number((divergence * 100).toFixed(3)),
        },
      })
    }
    return findings
  },
}
