import type { Finding } from '../../report/types'
import { sortedBars } from '../series'
import type { Rule } from '../types'

/**
 * FUNDAMENTALS_SIGN_VALIDITY — the fundamentals analogue of PRICE_NONPOSITIVE:
 * a traded company cannot have a non-positive (or non-finite) market cap or
 * share count. Such values are vendor placeholders for missing data leaking
 * into the feed, and any ratio built on them (P/E, yield, per-share metrics)
 * silently turns into nonsense.
 */
export const signValidity: Rule = {
  meta: {
    id: 'FUNDAMENTALS_SIGN_VALIDITY',
    block: 'fundamentals',
    severity: 'critical',
    dimension: 'validity',
    description: 'marketCap or sharesOutstanding non-positive (or non-finite)',
    defaultParams: {},
    references: [],
  },

  check(data, context) {
    const findings: Finding[] = []
    const fundamentals = data.fundamentals
    if (fundamentals === undefined) return findings

    const sorted = sortedBars(data.bars)
    const where = sorted.length > 0 ? { date: sorted[sorted.length - 1]!.timestamp } : undefined

    if (fundamentals.marketCap !== undefined) {
      const value = fundamentals.marketCap
      if (!Number.isFinite(value) || value <= 0) {
        findings.push({
          rule: 'FUNDAMENTALS_SIGN_VALIDITY',
          severity: context.config.severity,
          action: 'block',
          dimension: 'validity',
          where,
          explanation:
            `marketCap is ${value}, which is structurally impossible for a traded company: market ` +
            `capitalization must be a finite number greater than zero. Hypothesis: a vendor placeholder ` +
            `for missing data leaking into the feed — every ratio built on it (P/E, dividend yield, ` +
            `per-share metrics) silently becomes nonsense. Block this datum and re-fetch it from the source.`,
          evidence: { marketCap: value },
        })
      }
    }

    if (fundamentals.sharesOutstanding !== undefined) {
      const value = fundamentals.sharesOutstanding
      if (!Number.isFinite(value) || value <= 0) {
        findings.push({
          rule: 'FUNDAMENTALS_SIGN_VALIDITY',
          severity: context.config.severity,
          action: 'block',
          dimension: 'validity',
          where,
          explanation:
            `sharesOutstanding is ${value}, which is structurally impossible for a traded company: the ` +
            `share count must be a finite number greater than zero. Hypothesis: a vendor placeholder ` +
            `for missing data leaking into the feed — every per-share metric built on it silently ` +
            `becomes nonsense. Block this datum and re-fetch it from the source.`,
          evidence: { sharesOutstanding: value },
        })
      }
    }

    return findings
  },
}
