import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * DIVIDEND_FX_MISMATCH — the dividend is denominated in a different currency
 * than the price series.
 *
 * Documented case: Shell, BP and HSBC pay their dividends in USD while trading
 * in GBX (pence) on the LSE. A consumer that applies the dividend in the price
 * currency mixes scales — overstating yield and total return — so the pair
 * must be verified and converted explicitly before the dividend is applied.
 */
export const dividendFxMismatch: Rule = {
  meta: {
    id: 'DIVIDEND_FX_MISMATCH',
    block: 'metadata',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Dividend currency differs from the series currency',
    defaultParams: {},
    references: ['https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270'],
  },

  check(data, context) {
    const findings: Finding[] = []
    // Without a series currency there is nothing to compare against —
    // CURRENCY_SUSPECT already covers that completeness gap.
    if (data.currency === undefined) return findings
    const seriesCurrency = data.currency

    // One occurrence per distinct (dividend, series) currency pair: a stock
    // paying quarterly in the "wrong" currency is one defect, not four.
    const seenPairs = new Set<string>()

    for (const dividend of data.dividends ?? []) {
      const dividendCurrency = dividend.currency
      if (dividendCurrency === undefined || dividendCurrency === seriesCurrency) continue

      const pair = `${dividendCurrency}/${seriesCurrency}`
      if (seenPairs.has(pair)) continue
      seenPairs.add(pair)

      findings.push({
        rule: 'DIVIDEND_FX_MISMATCH',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} (ex-date ${dividend.exDate}) is denominated in ` +
          `${dividendCurrency} but the price series is in ${seriesCurrency}. Some issuers legitimately ` +
          `pay in a different currency than their listing currency — Shell, BP and HSBC pay USD ` +
          `dividends while trading in GBX (pence) on the LSE. A consumer that applies the dividend in ` +
          `the price currency mixes scales, overstating yield and total return. Verify the pair against ` +
          `the issuer's announcement and convert explicitly before applying the dividend.`,
        evidence: {
          dividend_currency: dividendCurrency,
          series_currency: seriesCurrency,
        },
      })
    }

    return findings
  },
}
