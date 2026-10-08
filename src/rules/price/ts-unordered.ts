import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * TS_UNORDERED — bars are not in chronological order.
 *
 * Every downstream calculation that walks the series (returns, gaps, rolling
 * windows) assumes chronological order; an out-of-order row silently degrades
 * all of them. Deliberately a WARNING: the fix is mechanical (sort by
 * timestamp), but the consumer must know the vendor delivered rows out of
 * order. Data libraries sort defensively for this reason: yfinance re-sorts its
 * own merged output before repairing it (`df.sort_index()  # important!`).
 * A documented vendor incident is still wanted as a better reference.
 *
 * Adjacent pairs are compared only when BOTH timestamps parse. Equal
 * timestamps are NOT flagged here — that ambiguity is TS_DUPLICATED's job.
 */
export const tsUnordered: Rule = {
  meta: {
    id: 'TS_UNORDERED',
    block: 'price',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Bars are not in chronological order',
    defaultParams: {},
    references: [
      'https://github.com/ranaroussi/yfinance/blob/5cae563642b59f49adf6a04a5ad6744f8b0e084d/yfinance/scrapers/history.py#L1509',
    ],
  },

  check(data, context) {
    const findings: Finding[] = []

    for (let index = 0; index < data.bars.length - 1; index += 1) {
      const current = data.bars[index]!
      const next = data.bars[index + 1]!
      const currentTime = Date.parse(current.timestamp)
      const nextTime = Date.parse(next.timestamp)
      if (Number.isNaN(currentTime) || Number.isNaN(nextTime)) continue
      if (nextTime >= currentTime) continue

      findings.push({
        rule: 'TS_UNORDERED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: next.timestamp },
        explanation:
          `Bar at ${next.timestamp} comes after ${current.timestamp} in the series, so bars are not in ` +
          `chronological order and every order-dependent calculation (returns, gaps) silently degrades. ` +
          `Hypothesis: the vendor appended or merged rows out of order; ` +
          `sort by timestamp before consuming.`,
        evidence: { previous: current.timestamp },
      })
    }

    return findings
  },
}
