import type { Finding } from '../../report/types'
import type { Rule } from '../types'
import { barIndexOnOrBefore, sortedBars } from '../series'

/**
 * DIV_SCALE_100X — a single dividend implausibly large vs the share price.
 *
 * Documented cases on Yahoo: HLCL.L showed a GBP 1.78 dividend while the
 * share traded around GBP 1.90 — a ~94% single-payment yield; the real
 * dividend was GBX 1.78, i.e. GBP 0.0178. LTI.L recorded 5150 instead of
 * 51.5 and BVT.L hit the same pence/pounds mix-up. A single payment above
 * 25% of the price is not a payout policy, it is a ×100 scale error that
 * destroys yield and total-return calculations.
 *
 * Exception — dividends TAGGED 'special': legitimate specials above 25% of
 * the price exist (ZIM's $17 of Dec 2021 was ~30%), so a tagged special is
 * degraded to 'info' with no ×100 hypothesis — verify the amount with the
 * issuer. Untagged and 'regular' payments keep the ×100 verdict.
 */
export const divScale100x: Rule = {
  meta: {
    id: 'DIV_SCALE_100X',
    block: 'corporate',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'Single dividend implausibly large vs price (probable 100x scale error)',
    defaultParams: {
      /** Max plausible single-payment yield (amount / previous close) before a scale error is suspected. */
      maxSingleYieldPct: 0.25,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { maxSingleYieldPct } = context.config.params as { maxSingleYieldPct: number }
    const findings: Finding[] = []
    const sorted = sortedBars(data.bars)

    for (const dividend of data.dividends ?? []) {
      if (!Number.isFinite(dividend.amount) || dividend.amount <= 0) continue
      const index = barIndexOnOrBefore(sorted, dividend.exDate)
      if (index < 1) continue
      const prevClose = sorted[index - 1]!.close
      if (!Number.isFinite(prevClose) || prevClose <= 0) continue

      const singleYield = dividend.amount / prevClose
      if (singleYield <= maxSingleYieldPct) continue

      if (dividend.type === 'special') {
        // Deliberate 'info': legitimate specials above 25% exist (ZIM's $17 of
        // Dec 2021 was ~30% of the price), so a tagged special gets no ×100
        // hypothesis — just a verification note.
        findings.push({
          rule: 'DIV_SCALE_100X',
          severity: 'info',
          action: 'flag',
          dimension: 'accuracy',
          where: { date: dividend.exDate },
          explanation:
            `Special dividend of ${dividend.amount} on ${dividend.exDate} equals ${(singleYield * 100).toFixed(1)}% ` +
            `of the previous close (${prevClose}) in a single payment — a large special dividend. Legitimate ` +
            `specials above ${maxSingleYieldPct * 100}% exist (e.g. ZIM's $17 of Dec 2021, ~30% of the price), ` +
            `so this is not read as a scale error. Verify the amount with the issuer.`,
          evidence: { amount: dividend.amount, prev_close: prevClose, single_yield_pct: singleYield },
        })
        continue
      }

      findings.push({
        rule: 'DIV_SCALE_100X',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} on ${dividend.exDate} equals ${(singleYield * 100).toFixed(1)}% of ` +
          `the previous close (${prevClose}) in a single payment — far above the ${maxSingleYieldPct * 100}% ` +
          `plausibility bound. This is the classic ×100 scale error (pence recorded as pounds; documented for ` +
          `HLCL.L, LTI.L and BVT.L on Yahoo): dividing by 100 yields ${dividend.amount / 100}, a plausible ` +
          `payment. Verify the dividend's currency and scale against the issuer's announcement and rescale.`,
        evidence: {
          amount: dividend.amount,
          prev_close: prevClose,
          single_yield_pct: singleYield,
          hypothesized_amount: dividend.amount / 100,
        },
      })
    }

    return findings
  },
}
