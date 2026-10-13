import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * TS_UNORDERED — bars are not in chronological order.
 *
 * Every downstream calculation that walks the series (returns, gaps, rolling
 * windows) assumes chronological order; an out-of-order row silently degrades
 * all of them. Deliberately a WARNING: the fix is mechanical (sort by
 * timestamp), but the consumer must know the vendor delivered rows out of
 * order. Documented case: from 2020-02-03, FX daily data reached alpha_vantage
 * users newest-first (RomelTorres/alpha_vantage#186), so positional slices
 * returned the wrong values; the vendor said its feed had not changed, the
 * order flipped in the client's JSON → DataFrame step. Data libraries sort
 * defensively for this reason: yfinance re-sorts its own merged output
 * (`df.sort_index()  # important!`).
 *
 * A series delivered entirely newest-first is ONE problem, reported once with
 * its order, first and last date; flagging every adjacent pair of a 250-bar
 * reversed series would bury it under 249 findings. Mixed disorder keeps one
 * finding per inversion.
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
      'https://github.com/RomelTorres/alpha_vantage/issues/186',
      'https://github.com/ranaroussi/yfinance/blob/5cae563642b59f49adf6a04a5ad6744f8b0e084d/yfinance/scrapers/history.py#L1509',
    ],
  },

  check(data, context) {
    const findings: Finding[] = []

    const reversed = newestFirst(data.bars)
    if (reversed) {
      findings.push({
        rule: 'TS_UNORDERED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: reversed.first },
        explanation:
          `The whole series runs newest-first: ${reversed.bars} bars from ${reversed.first} back to ${reversed.last}. ` +
          `Any calculation that walks it in order (returns, gaps, positional slices) reads it backwards. ` +
          `Hypothesis: the vendor or the client library delivers descending order; sort ascending by ` +
          `timestamp before consuming.`,
        evidence: { order: 'descending', first: reversed.first, last: reversed.last, bars: reversed.bars },
      })
      return findings
    }

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

/** The series runs strictly newest-first (3+ bars, every timestamp parses), or null. */
function newestFirst(bars: ReadonlyArray<{ timestamp: string }>): { first: string; last: string; bars: number } | null {
  if (bars.length < 3) return null
  for (let index = 0; index < bars.length - 1; index += 1) {
    const current = Date.parse(bars[index]!.timestamp)
    const next = Date.parse(bars[index + 1]!.timestamp)
    if (Number.isNaN(current) || Number.isNaN(next) || next >= current) return null
  }
  return { first: bars[0]!.timestamp, last: bars[bars.length - 1]!.timestamp, bars: bars.length }
}
