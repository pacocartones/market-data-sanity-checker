import { median } from '../stats'
import { sortedBars } from '../series'
import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * CURRENCY_SUSPECT — missing currency, or a GBP label on a series that looks
 * like pence.
 *
 * Documented case: the LSE quotes in pence (GBX), not pounds, and thousands of
 * products have ingested pence as pounds — a silent ×100 error. Yahoo in
 * particular sometimes labels GBX series as GBP, so a London symbol ('.L')
 * tagged GBP whose price magnitude looks like pence is a classic tell.
 */
export const currencySuspect: Rule = {
  meta: {
    id: 'CURRENCY_SUSPECT',
    block: 'metadata',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Currency missing, or GBP label with pence-looking price magnitudes',
    defaultParams: {
      /** Median close above which a '.L' GBP-labelled series looks like pence, not pounds. */
      penceMagnitudeThreshold: 500,
    },
    references: [
      'https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270',
      'https://www.fool.co.uk/investing-basics/why-are-uk-stock-prices-quoted-in-pence-not-pounds/',
    ],
  },

  check(data, context) {
    const { penceMagnitudeThreshold } = context.config.params as {
      penceMagnitudeThreshold: number
    }
    const findings: Finding[] = []

    if (data.currency === undefined) {
      // Degraded to 'info' on purpose: a missing currency is a completeness
      // gap worth a note, not a suspicion of wrong data — every downstream
      // consumer can still use the series if it knows the venue.
      findings.push({
        rule: 'CURRENCY_SUSPECT',
        severity: 'info',
        action: 'flag',
        dimension: 'consistency',
        explanation:
          `Dataset for ${data.symbol} has no currency. Without it, prices cannot be interpreted ` +
          `(the LSE quotes in pence (GBX), not pounds — a GBP/GBX mix-up is a silent ×100 error). ` +
          `Record the trading currency explicitly, and use GBX for pence-quoted series.`,
        evidence: { symbol: data.symbol, reason: 'currency_missing' },
      })
      return findings
    }

    const sorted = sortedBars(data.bars)
    const closes = sorted.map((bar) => bar.close).filter((close) => Number.isFinite(close))
    if (data.currency === 'GBP' && data.symbol.endsWith('.L') && closes.length > 0) {
      const medianClose = median(closes)
      if (medianClose > penceMagnitudeThreshold) {
        findings.push({
          rule: 'CURRENCY_SUSPECT',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          where: { date: sorted[sorted.length - 1]!.timestamp },
          explanation:
            `${data.symbol} is labelled GBP but its price magnitude (median close ${medianClose}) ` +
            `looks like pence — London-listed stocks are quoted in GBX, and vendors (Yahoo among them) ` +
            `sometimes mislabel pence series as GBP, a silent ×100 error that corrupts every valuation ` +
            `built on it. Verify whether the real series is GBX and relabel or rescale.`,
          evidence: {
            symbol: data.symbol,
            currency: data.currency,
            median_close: medianClose,
            threshold: penceMagnitudeThreshold,
            reason: 'pence_magnitude',
          },
        })
      }
    }

    return findings
  },
}
