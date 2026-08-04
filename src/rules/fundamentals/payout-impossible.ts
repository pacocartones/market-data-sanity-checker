import type { Finding } from '../../report/types'
import { sortedBars } from '../series'
import type { Rule } from '../types'

/**
 * PAYOUT_IMPOSSIBLE — a payout ratio that cannot be taken at face value.
 *
 * Payout = dividends / earnings. A negative ratio means the vendor published
 * the formula's output on negative earnings, where the number is not
 * interpretable as a payout policy. A ratio far above 100% is NOT
 * automatically wrong: for REITs and MLPs a payout/EPS around 290% is
 * structurally normal, because depreciation depresses EPS — the valid metric
 * for them is FFO, not EPS (2026-07-31 audit). The threshold therefore sits
 * at 300% of EPS, beyond even the REIT/MLP regime; above it the datum signals
 * stale EPS or a data error. Both defects are catalogued in A Simple Model's
 * review of sloppy sell-side research data.
 */
export const payoutImpossible: Rule = {
  meta: {
    id: 'PAYOUT_IMPOSSIBLE',
    block: 'fundamentals',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'Payout ratio negative or far above 100%',
    defaultParams: {
      /** Max plausible payout ratio; above this the datum is suspect even for REITs/MLPs (use FFO for them). */
      maxPayout: 3.0,
    },
    references: ['https://www.asimplemodel.com/insights/extremely-sloppy-and-dubious-sell-side-research'],
  },

  check(data, context) {
    const { maxPayout } = context.config.params as { maxPayout: number }
    const payoutRatio = data.fundamentals?.payoutRatio
    if (payoutRatio === undefined || !Number.isFinite(payoutRatio)) return []

    const sorted = sortedBars(data.bars)
    if (sorted.length === 0) return []
    const lastBar = sorted[sorted.length - 1]!

    const findings: Finding[] = []

    if (payoutRatio < 0) {
      findings.push({
        rule: 'PAYOUT_IMPOSSIBLE',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: lastBar.timestamp },
        explanation:
          `Payout ratio of ${payoutRatio} is negative: dividends over negative earnings produces a number ` +
          `that says nothing about payout policy, yet vendors publish it as-is (A Simple Model, "Extremely ` +
          `Sloppy and Dubious Sell-Side Research"). Treat the field as missing and verify earnings and ` +
          `dividends against the issuer's latest filing.`,
        evidence: { payoutRatio },
      })
    } else if (payoutRatio > maxPayout) {
      findings.push({
        rule: 'PAYOUT_IMPOSSIBLE',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: lastBar.timestamp },
        explanation:
          `Payout ratio of ${payoutRatio} exceeds ${maxPayout} (${maxPayout * 100}% of EPS). For REITs and ` +
          `MLPs a payout above 100% of EPS is structurally normal — depreciation depresses EPS, so FFO is ` +
          `the valid metric, not EPS — but even for them ${maxPayout * 100}% is extreme; for any other ` +
          `issuer this signals stale EPS or a data error (A Simple Model, "Extremely Sloppy and Dubious ` +
          `Sell-Side Research"). Verify dividends and earnings against the issuer's latest filing.`,
        evidence: { payoutRatio },
      })
    }

    return findings
  },
}
