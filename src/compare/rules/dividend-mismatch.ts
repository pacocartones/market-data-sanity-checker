import type { Finding } from '../../report/types'
import type { Dividend } from '../../schema/market-data'
import type { CompareRule } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Absolute distance between two ex-dates, in calendar days. */
function daysApart(x: string, y: string): number {
  return Math.abs(Date.parse(x) - Date.parse(y)) / MS_PER_DAY
}

/**
 * DIVIDEND_MISMATCH — a dividend present in one source is missing or carries
 * a different amount in the other.
 *
 * Corporate actions are where vendor feeds diverge most silently: yfinance
 * issue #2214 documents the library disagreeing with Yahoo's own website on
 * dividend history. A missing or mis-scaled dividend corrupts every yield and
 * every total-return series built on top, so each mismatch is reported per
 * ex-date with the amounts on both sides. Matching allows a small calendar
 * window — vendors occasionally disagree on the ex-date by a few days even
 * when they agree on the event itself.
 */
export const dividendMismatch: CompareRule = {
  meta: {
    id: 'DIVIDEND_MISMATCH',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Dividend present in one source but missing or different in the other',
    defaultParams: {
      /** Maximum distance (calendar days) between ex-dates to consider two dividends the same event. */
      matchWindowDays: 7,
      /** Relative amount difference (fraction) above which matched dividends are flagged. */
      amountTolerancePct: 0.01,
    },
    references: ['https://github.com/ranaroussi/yfinance/issues/2214'],
  },

  check(a, b, context) {
    const { matchWindowDays, amountTolerancePct } = context.config.params as {
      matchWindowDays: number
      amountTolerancePct: number
    }
    const dividendsA = a.dividends ?? []
    const dividendsB = b.dividends ?? []

    const matchIn = (dividend: Dividend, candidates: readonly Dividend[]): Dividend | undefined =>
      candidates.find((candidate) => daysApart(dividend.exDate, candidate.exDate) <= matchWindowDays)

    const findings: Finding[] = []

    for (const dividend of dividendsA) {
      const match = matchIn(dividend, dividendsB)
      if (!match) {
        findings.push({
          rule: 'DIVIDEND_MISMATCH',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          where: { date: dividend.exDate },
          explanation:
            `${a.source} reports a ${a.symbol} dividend of ${dividend.amount} with ex-date ${dividend.exDate}, ` +
            `but ${b.source} has no dividend within ${matchWindowDays} days of it. One of the feeds carries ` +
            `incomplete corporate actions — yfinance has been documented disagreeing with Yahoo's own website ` +
            `on dividend history. Reconcile both against the issuer's notices before computing yields.`,
          evidence: { reason: 'missing_in_b', exDate: dividend.exDate, amount_a: dividend.amount },
        })
        continue
      }
      const scale = Math.max(Math.abs(dividend.amount), Math.abs(match.amount))
      const divergence = scale === 0 ? 0 : Math.abs(dividend.amount - match.amount) / scale
      if (divergence > amountTolerancePct) {
        findings.push({
          rule: 'DIVIDEND_MISMATCH',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          where: { date: dividend.exDate },
          explanation:
            `${a.source} and ${b.source} both report a ${a.symbol} dividend around ${dividend.exDate}, but the ` +
            `amounts differ: ${dividend.amount} vs ${match.amount} (${(divergence * 100).toFixed(2)}% apart). ` +
            `Same event, different amounts usually means one feed is mis-scaled (currency, special vs regular ` +
            `classification, or a stale adjustment). Reconcile before computing yields or total returns.`,
          evidence: {
            reason: 'amount_differs',
            exDate: dividend.exDate,
            amount_a: dividend.amount,
            amount_b: match.amount,
          },
        })
      }
    }

    for (const dividend of dividendsB) {
      if (matchIn(dividend, dividendsA)) continue
      findings.push({
        rule: 'DIVIDEND_MISMATCH',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: dividend.exDate },
        explanation:
          `${b.source} reports a ${b.symbol} dividend of ${dividend.amount} with ex-date ${dividend.exDate}, ` +
          `but ${a.source} has no dividend within ${matchWindowDays} days of it. One of the feeds carries ` +
          `incomplete corporate actions — yfinance has been documented disagreeing with Yahoo's own website ` +
          `on dividend history. Reconcile both against the issuer's notices before computing yields.`,
        evidence: { reason: 'missing_in_a', exDate: dividend.exDate, amount_b: dividend.amount },
      })
    }

    return findings
  },
}
