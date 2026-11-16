import type { Finding } from '../../report/types'
import type { Rule } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000
const PEER_WINDOW_DAYS = 365 * 3

/** Counts positive regular payments by amount and selects median ranks. */
class AmountRanks {
  private readonly values: number[]
  private readonly positions: Map<number, number>
  private readonly tree: number[]
  count = 0

  constructor(amounts: number[]) {
    this.values = [...new Set(amounts)].sort((a, b) => a - b)
    this.positions = new Map(this.values.map((amount, index) => [amount, index + 1]))
    this.tree = new Array<number>(this.values.length + 1).fill(0)
  }

  change(amount: number, delta: number): void {
    this.count += delta
    for (let index = this.positions.get(amount)!; index < this.tree.length; index += index & -index) {
      this.tree[index]! += delta
    }
  }

  private atRank(rank: number): number {
    let index = 0
    let bit = 1
    while (bit * 2 < this.tree.length) bit *= 2
    for (; bit > 0; bit = Math.floor(bit / 2)) {
      const next = index + bit
      if (next < this.tree.length && this.tree[next]! < rank) {
        rank -= this.tree[next]!
        index = next
      }
    }
    return this.values[index]!
  }

  median(): number {
    if (this.count === 0) return 0
    const upper = this.atRank(Math.floor(this.count / 2) + 1)
    return this.count % 2 === 1 ? upper : (this.atRank(this.count / 2) + upper) / 2
  }
}

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

    const dated = timed.filter((item) => !Number.isNaN(item.time))
      .sort((a, b) => a.time - b.time || a.index - b.index)
    const isolated = new Array<boolean>(timed.length).fill(false)
    const isolationMs = isolationDays * DAY_MS
    for (let position = 0; position < dated.length; position += 1) {
      const current = dated[position]!
      const before = dated[position - 1]
      const after = dated[position + 1]
      isolated[current.index] =
        (!before || current.time - before.time > isolationMs) &&
        (!after || after.time - current.time > isolationMs)
    }

    const regular = dated.filter((item) => item.dividend.type === 'regular' &&
      Number.isFinite(item.dividend.amount) && item.dividend.amount > 0)
    const ranks = new AmountRanks(regular.map((item) => item.dividend.amount))
    const peerMedians = new Map<number, number>()
    let windowStart = 0
    for (let cursor = 0; cursor < regular.length;) {
      const time = regular[cursor]!.time
      while (windowStart < cursor && regular[windowStart]!.time < time - PEER_WINDOW_DAYS * DAY_MS) {
        ranks.change(regular[windowStart]!.dividend.amount, -1)
        windowStart += 1
      }
      let groupEnd = cursor + 1
      while (groupEnd < regular.length && regular[groupEnd]!.time === time) groupEnd += 1
      if (!(ranks.count < minPeers)) {
        const peerMedian = ranks.median()
        for (let index = cursor; index < groupEnd; index += 1) {
          peerMedians.set(regular[index]!.index, peerMedian)
        }
      }
      for (let index = cursor; index < groupEnd; index += 1) {
        ranks.change(regular[index]!.dividend.amount, 1)
      }
      cursor = groupEnd
    }

    for (const { dividend, index, time } of timed) {
      if (dividend.type !== 'regular') continue
      if (!Number.isFinite(dividend.amount) || dividend.amount <= 0) continue
      if (Number.isNaN(time)) continue

      const peerMedian = peerMedians.get(index)
      if (peerMedian === undefined) continue
      if (dividend.amount <= magnitudeRatio * peerMedian) continue
      if (!isolated[index]) continue

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
