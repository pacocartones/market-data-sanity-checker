import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * TS_DUPLICATED — two or more bars share the same timestamp.
 *
 * Duplicated rows make the datum ambiguous by construction: a consumer cannot
 * know which bar to use for that instant, and any choice silently discards
 * information. This is a documented vendor failure mode (yfinance issue #902),
 * so it is a CRITICAL — the series must be blocked and deduplicated against
 * the source, not patched locally.
 *
 * Timestamps are grouped by their parsed time; unparseable ones fall back to
 * the raw string, so identical garbage still groups together.
 */
export const tsDuplicated: Rule = {
  meta: {
    id: 'TS_DUPLICATED',
    block: 'price',
    severity: 'critical',
    dimension: 'uniqueness',
    description: 'Two or more bars share the same timestamp',
    defaultParams: {},
    references: ['https://github.com/ranaroussi/yfinance/issues/902'],
  },

  check(data, context) {
    const groups = new Map<string | number, { timestamp: string; count: number }>()
    for (const bar of data.bars) {
      const parsed = Date.parse(bar.timestamp)
      const key = Number.isNaN(parsed) ? bar.timestamp : parsed
      const group = groups.get(key)
      if (group) {
        group.count += 1
      } else {
        groups.set(key, { timestamp: bar.timestamp, count: 1 })
      }
    }

    const findings: Finding[] = []
    for (const { timestamp, count } of groups.values()) {
      if (count < 2) continue

      findings.push({
        rule: 'TS_DUPLICATED',
        severity: context.config.severity,
        action: 'block',
        dimension: 'uniqueness',
        where: { date: timestamp },
        explanation:
          `${count} bars share the timestamp ${timestamp}, so a consumer cannot know which one to use — ` +
          `the datum is ambiguous by construction. Hypothesis: the vendor emitted duplicated rows ` +
          `(documented in yfinance issue #902). Block the series and deduplicate against the source ` +
          `before consuming it.`,
        evidence: { count },
      })
    }

    return findings
  },
}
