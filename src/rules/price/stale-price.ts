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
 *
 * The halt excuse has a limit. A zero-volume run longer than maxHaltSessions is
 * reported at `info` (review, don't block): a frozen feed can print volume 0 every
 * day, as in yfinance #2966, where Santiago stocks stayed at their 2026-07-17
 * close for weeks. The default of 10 sessions is the longest summary trading
 * suspension the SEC may order on its own (Exchange Act §12(k)(1)(A), "not
 * exceeding 10 business days"). Exchanges can suspend longer, which is why
 * this case is `info`, not a warning (issue #59).
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
      /** A zero-volume run longer than this is no longer excused as a halt and is reported at `info`. */
      maxHaltSessions: 10,
    },
    references: [
      'https://github.com/ranaroussi/yfinance/issues/2966',
      'https://www.law.cornell.edu/uscode/text/15/78l',
      'https://eodhd.com/financial-academy/fundamental-analysis-examples/real-time-market-data-reliability-stale-price-detection-rest-fallback-and-websocket-recovery',
    ],
  },

  check(data, context) {
    const { consecutiveSessions, maxHaltSessions } = context.config.params as {
      consecutiveSessions: number
      maxHaltSessions: number
    }
    const findings: Finding[] = []
    const bars = data.bars

    let runStart = 0
    for (let index = 1; index <= bars.length; index += 1) {
      if (index < bars.length && bars[index]!.close === bars[runStart]!.close) continue

      const sessions = index - runStart
      const traded = bars
        .slice(runStart, index)
        .some((bar) => bar.volume === undefined || bar.volume > 0)
      const first = bars[runStart]!
      const last = bars[index - 1]!
      if (sessions >= consecutiveSessions && traded) {
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
      } else if (!traded && sessions > maxHaltSessions && sessions >= consecutiveSessions) {
        findings.push({
          rule: 'STALE_PRICE',
          severity: 'info',
          action: 'review',
          dimension: 'timeliness',
          where: { date: last.timestamp },
          explanation:
            `The close was exactly ${last.close} with volume 0 for ${sessions} consecutive sessions ` +
            `(${first.timestamp} → ${last.timestamp}), longer than the ${maxHaltSessions} sessions a trading halt ` +
            `is assumed to last. It may be a long suspension, or a frozen feed printing volume 0. Check the ` +
            `exchange's notices for a suspension before trusting these bars.`,
          evidence: {
            sessions,
            close: last.close,
            from: first.timestamp,
            to: last.timestamp,
            zero_volume: true,
          },
        })
      }

      runStart = index
    }

    return findings
  },
}
