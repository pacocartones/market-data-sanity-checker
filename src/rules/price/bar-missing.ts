import type { Finding } from '../../report/types'
import { weekdaysBetween } from '../calendar'
import type { Rule } from '../types'

/**
 * BAR_MISSING — completeness check for absent trading days.
 *
 * A gap of a full trading week (5+ Mon–Fri days) between consecutive bars is
 * too long to be explained by weekends plus exchange holidays. Entire daily
 * rows silently absent from the feed is a documented vendor failure mode
 * (yfinance price-repair docs: 1COV.DE, 0316.HK); the alternative hypothesis
 * is a trading halt the vendor never recorded.
 *
 * Only adjacent pairs with parseable, ordered timestamps are judged —
 * out-of-order bars are TS_UNORDERED's job, not ours.
 */
export const barMissing: Rule = {
  meta: {
    id: 'BAR_MISSING',
    block: 'price',
    severity: 'warning',
    dimension: 'completeness',
    description: 'Gap of a full trading week or more between consecutive bars',
    defaultParams: {
      /** Missing Mon–Fri days between two bars that flags the gap (a full trading week). */
      minMissingWeekdays: 5,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { minMissingWeekdays } = context.config.params as { minMissingWeekdays: number }
    const findings: Finding[] = []

    for (let index = 0; index < data.bars.length - 1; index += 1) {
      const previous = data.bars[index]!
      const current = data.bars[index + 1]!

      const from = Date.parse(previous.timestamp)
      const to = Date.parse(current.timestamp)
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue

      const gapWeekdays = weekdaysBetween(previous.timestamp, current.timestamp)
      if (gapWeekdays < minMissingWeekdays) continue

      findings.push({
        rule: 'BAR_MISSING',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'completeness',
        where: { date: current.timestamp },
        explanation:
          `${gapWeekdays} weekdays elapsed between ${previous.timestamp} and ${current.timestamp} with no bar ` +
          `recorded — too long to be explained by weekends and exchange holidays. Hypothesis: a vendor data gap ` +
          `(entire daily rows silently absent is a documented feed failure) or an unrecorded trading halt. ` +
          `Reconstruct the gap from smaller intervals or cross-check a second source before consuming the series.`,
        evidence: {
          gap_weekdays: gapWeekdays,
          from: previous.timestamp,
          to: current.timestamp,
        },
      })
    }

    return findings
  },
}
