import type { Finding } from '../../report/types'
import type { Rule } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * DIV_DUPLICATED — the same dividend recorded twice within a few days.
 *
 * Documented case: ALC.SW on Yahoo, where a CHF 0.21 dividend appeared on
 * both 9-May-2023 and 10-May-2023. Duplicated dividends double-count income
 * in yield and total-return calculations, and usually signal a vendor bug in
 * its corporate-actions feed rather than two real payments days apart.
 */
export const divDuplicated: Rule = {
  meta: {
    id: 'DIV_DUPLICATED',
    block: 'corporate',
    severity: 'warning',
    dimension: 'uniqueness',
    description: 'Same dividend amount recorded twice within a few days',
    defaultParams: {
      /** Max days between two ex-dates to be considered duplicates. */
      windowDays: 7,
      /** Relative tolerance when comparing amounts (vendors sometimes round differently). */
      amountTolerancePct: 0.001,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { windowDays, amountTolerancePct } = context.config.params as {
      windowDays: number
      amountTolerancePct: number
    }
    const findings: Finding[] = []
    const dividends = data.dividends ?? []

    for (let first = 0; first < dividends.length; first += 1) {
      for (let second = first + 1; second < dividends.length; second += 1) {
        const a = dividends[first]!
        const b = dividends[second]!
        const aTime = Date.parse(a.exDate)
        const bTime = Date.parse(b.exDate)
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) continue

        const daysApart = Math.abs(bTime - aTime) / DAY_MS
        if (daysApart > windowDays) continue

        const scale = Math.max(Math.abs(a.amount), Math.abs(b.amount))
        const sameAmount =
          scale === 0 ? a.amount === b.amount : Math.abs(a.amount - b.amount) / scale <= amountTolerancePct
        if (!sameAmount) continue

        findings.push({
          rule: 'DIV_DUPLICATED',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'uniqueness',
          where: { date: b.exDate },
          explanation:
            `Dividend of ${b.amount} on ${b.exDate} duplicates the ${a.amount} payment on ${a.exDate} ` +
            `(${Math.round(daysApart)} day(s) apart). Documented vendor defect (e.g. ALC.SW on Yahoo, May 2023): ` +
            `it double-counts income in yield and total-return calculations. Verify against the issuer's ` +
            `announcement and drop the duplicate.`,
          evidence: {
            amount: b.amount,
            first_exDate: a.exDate,
            duplicate_exDate: b.exDate,
            days_apart: Math.round(daysApart),
          },
        })
      }
    }

    return findings
  },
}
