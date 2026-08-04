import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * STALE_PRICE — timeliness check for frozen feeds.
 *
 * The exact same close repeated for several consecutive sessions while volume
 * keeps printing is the signature of a stale or frozen feed, not a flat
 * market: real trading almost never produces bit-identical closes day after
 * day. A run where every bar has volume 0 is excused — that pattern matches a
 * legitimate trading halt, not a stuck feed — while absent volume data cannot
 * prove a halt, so it still counts as suspicious. NaN closes never compare
 * equal, so they break runs instead of extending them.
 */
export const stalePrice: Rule = {
  meta: {
    id: 'STALE_PRICE',
    block: 'price',
    severity: 'warning',
    dimension: 'timeliness',
    description: 'Identical close repeated for several sessions with trading volume',
    defaultParams: {
      /** Consecutive identical closes required to flag a run as stale. */
      consecutiveSessions: 3,
    },
    references: [
      'https://eodhd.com/financial-academy/fundamental-analysis-examples/real-time-market-data-reliability-stale-price-detection-rest-fallback-and-websocket-recovery',
    ],
  },

  check(data, context) {
    const { consecutiveSessions } = context.config.params as { consecutiveSessions: number }
    const findings: Finding[] = []
    const bars = data.bars

    let runStart = 0
    for (let index = 1; index <= bars.length; index += 1) {
      if (index < bars.length && bars[index]!.close === bars[runStart]!.close) continue

      const sessions = index - runStart
      const traded = bars
        .slice(runStart, index)
        .some((bar) => bar.volume === undefined || bar.volume > 0)
      if (sessions >= consecutiveSessions && traded) {
        const first = bars[runStart]!
        const last = bars[index - 1]!
        findings.push({
          rule: 'STALE_PRICE',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'timeliness',
          where: { date: last.timestamp },
          explanation:
            `The close was exactly ${last.close} for ${sessions} consecutive sessions (${first.timestamp} → ` +
            `${last.timestamp}) while trading volume was present. Hypothesis: a stale or frozen feed repeating ` +
            `the last known price, not a genuinely flat market — verify data freshness against the source ` +
            `before consuming these bars.`,
          evidence: {
            sessions,
            close: last.close,
            from: first.timestamp,
            to: last.timestamp,
          },
        })
      }

      runStart = index
    }

    return findings
  },
}
