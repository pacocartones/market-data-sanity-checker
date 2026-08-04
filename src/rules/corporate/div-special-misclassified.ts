import type { Finding } from '../../report/types'
import type { Rule } from '../types'
import { median } from '../stats'

const DAY_MS = 24 * 60 * 60 * 1000
const PEER_WINDOW_DAYS = 365 * 3

/**
 * DIV_SPECIAL_MISCLASSIFIED — a 'regular' dividend that is an extreme
 * outlier vs the issuer's own history and isolated in the calendar.
 *
 * Special dividends mistagged as regular distort trailing yields and any
 * signal built on payout regularity. Documented in yfinance's price-repair
 * notes: capital-gains distributions double-counted as ordinary dividends
 * (the DODFX case). The fix is reclassification, not deletion.
 */
export const divSpecialMisclassified: Rule = {
  meta: {
    id: 'DIV_SPECIAL_MISCLASSIFIED',
    block: 'corporate',
    severity: 'info',
    dimension: 'consistency',
    description: "Regular-tagged dividend is an extreme outlier vs the issuer's own history",
    defaultParams: {
      /** Multiple of the issuer's median regular dividend above which a payment is an outlier. */
      magnitudeRatio: 5,
      /** Min days from any other dividend for the payment to count as calendar-isolated. */
      isolationDays: 90,
      /** Min regular dividends in the prior 3 years needed for a reliable median. */
      minPeers: 4,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { magnitudeRatio, isolationDays, minPeers } = context.config.params as {
      magnitudeRatio: number
      isolationDays: number
      minPeers: number
    }
    const findings: Finding[] = []
    const timed = (data.dividends ?? []).map((dividend, index) => ({
      dividend,
      index,
      time: Date.parse(dividend.exDate),
    }))

    for (const { dividend, index, time } of timed) {
      if (dividend.type !== 'regular') continue
      if (!Number.isFinite(dividend.amount) || dividend.amount <= 0) continue
      if (Number.isNaN(time)) continue

      const peers = timed.filter(
        (other) =>
          other.index !== index &&
          other.dividend.type === 'regular' &&
          Number.isFinite(other.dividend.amount) &&
          other.dividend.amount > 0 &&
          !Number.isNaN(other.time) &&
          other.time < time &&
          other.time >= time - PEER_WINDOW_DAYS * DAY_MS,
      )
      if (peers.length < minPeers) continue

      const peerMedian = median(peers.map((peer) => peer.dividend.amount))
      if (dividend.amount <= magnitudeRatio * peerMedian) continue

      const isolated = timed.every(
        (other) =>
          other.index === index ||
          Number.isNaN(other.time) ||
          Math.abs(other.time - time) > isolationDays * DAY_MS,
      )
      if (!isolated) continue

      findings.push({
        rule: 'DIV_SPECIAL_MISCLASSIFIED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} on ${dividend.exDate} is tagged 'regular' but is ` +
          `${(dividend.amount / peerMedian).toFixed(1)}x the issuer's median regular payment ` +
          `(${peerMedian} over the prior 3 years) and sits more than ${isolationDays} days away from any ` +
          `other dividend. That profile fits a special or capital-gains distribution mistagged as regular ` +
          `(documented in yfinance, e.g. the DODFX double-counted capital gains): it inflates trailing ` +
          `yields and corrupts payout-regularity signals. Review the classification against the issuer's ` +
          `announcement — reclassify, don't delete.`,
        evidence: {
          amount: dividend.amount,
          peer_median: peerMedian,
          ratio: dividend.amount / peerMedian,
        },
      })
    }

    return findings
  },
}
