import type { Finding } from '../../report/types'
import { barIndexOnOrBefore, sortedBars } from '../series'
import type { Rule } from '../types'

/**
 * EXDATE_AFTER_PAYDATE — the payment date is earlier than the ex-date.
 *
 * In the standard dividend lifecycle the ex-date precedes the payment date
 * (see the LSEG corporate actions content set guide): a pay date recorded
 * BEFORE the ex-date almost always means the vendor swapped the two fields
 * when mapping its corporate-actions feed, so the record cannot be trusted
 * in either position — block, don't repair.
 *
 * One legitimate exception exists, and it is regulatory: FINRA Rule
 * 11140(b)(2) MANDATES the inverted order for cash distributions of 25% or
 * more of the security's value (due-bill mechanics — the ex-date is the
 * first business day after the payable date). ZIM's $17 special (Dec 2021,
 * ~30% of the price) traded exactly that way. The rule therefore exempts any
 * single payment at or above 20% of the previous close (a safety margin
 * below the regulatory 25%); when no usable previous close exists the size
 * cannot be judged and the finding stands. Downgraded from critical to
 * warning after the 2026-07-31 audit: the inverted order is not
 * "structurally impossible" — for large specials it is mandatory.
 */
export const exdateAfterPaydate: Rule = {
  meta: {
    id: 'EXDATE_AFTER_PAYDATE',
    block: 'corporate',
    severity: 'warning',
    dimension: 'validity',
    description: 'Payment date precedes ex-date (field swap, unless a large special dividend mandates it)',
    defaultParams: {
      /** Single-dividend size (amount / previous close) at or above which FINRA 11140(b)(2) can mandate ex-date after pay date. */
      largeDividendPct: 0.2,
    },
    references: [
      'https://developers.lseg.com/en/article-catalog/article/workspace-corporate-actions-content-set-guide',
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/11140',
    ],
  },

  check(data, context) {
    const { largeDividendPct } = context.config.params as { largeDividendPct: number }
    const findings: Finding[] = []
    const dividends = data.dividends ?? []
    const sorted = sortedBars(data.bars)

    for (const dividend of dividends) {
      if (dividend.payDate === undefined) continue
      const exTime = Date.parse(dividend.exDate)
      const payTime = Date.parse(dividend.payDate)
      if (Number.isNaN(exTime) || Number.isNaN(payTime)) continue
      if (payTime >= exTime) continue

      // FINRA 11140(b)(2) exemption: for a single cash dividend worth 25%+ of
      // the security the exchange must set the ex-date AFTER the pay date
      // (due-bill mechanics), so a large payment cannot be called a field
      // swap. Without a usable previous close the size cannot be judged and
      // the finding stands.
      const index = barIndexOnOrBefore(sorted, dividend.exDate)
      if (index >= 1 && Number.isFinite(dividend.amount) && dividend.amount > 0) {
        const prevClose = sorted[index - 1]!.close
        if (Number.isFinite(prevClose) && prevClose > 0 && dividend.amount >= largeDividendPct * prevClose) {
          continue
        }
      }

      findings.push({
        rule: 'EXDATE_AFTER_PAYDATE',
        severity: context.config.severity,
        action: 'block',
        dimension: 'validity',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} has pay date ${dividend.payDate} BEFORE its ex-date ${dividend.exDate}. ` +
          `In the standard dividend lifecycle the ex-date precedes the payment date, so this almost always means ` +
          `the vendor swapped the ex-date and pay-date fields when mapping its corporate-actions feed. The only ` +
          `legitimate exception is regulatory — FINRA Rule 11140(b)(2) mandates the inverted order for cash ` +
          `distributions of 25% or more of the security's value (due-bill mechanics) — and this payment is too ` +
          `small for that regime (or its size cannot be determined from the bars). Block the record and re-pull ` +
          `it from the issuer's announcement.`,
        evidence: { exDate: dividend.exDate, payDate: dividend.payDate },
      })
    }

    return findings
  },
}
