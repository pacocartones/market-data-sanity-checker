import type { Finding } from '../../report/types'
import type { Rule } from '../types'

const OHLC_FIELDS = ['open', 'high', 'low', 'close'] as const

/**
 * PRICE_NONPOSITIVE — rule P2 of the tick-data cleaning literature
 * (Barndorff-Nielsen, Hansen, Lunde & Shephard, 2009): a traded instrument
 * cannot print a zero, negative or non-finite price. Such values are vendor
 * placeholders, failed adjustments or parsing artifacts — never real trades.
 */
export const priceNonpositive: Rule = {
  meta: {
    id: 'PRICE_NONPOSITIVE',
    block: 'price',
    severity: 'critical',
    dimension: 'validity',
    description: 'Open/high/low/close is zero, negative or not a finite number',
    defaultParams: {},
    references: [
      'https://public.econ.duke.edu/~get/browse/courses/201/spr12/DOWNLOADS/MicroStructure/bhls_kernels_practice_08.pdf',
    ],
  },

  check(data, context) {
    const findings: Finding[] = []

    for (const bar of data.bars) {
      for (const field of OHLC_FIELDS) {
        const value = bar[field]
        if (Number.isFinite(value) && value > 0) continue

        findings.push({
          rule: 'PRICE_NONPOSITIVE',
          severity: context.config.severity,
          action: 'block',
          dimension: 'validity',
          where: { date: bar.timestamp },
          explanation:
            `The ${field} price is ${value}, which is structurally impossible for a traded instrument: ` +
            `prices must be finite numbers greater than zero (rule P2 of Barndorff-Nielsen et al., 2009). ` +
            `Hypothesis: a vendor placeholder or a failed price adjustment leaking into the feed. ` +
            `Block this bar and re-fetch it from the source.`,
          evidence: { field, value },
        })
      }
    }

    return findings
  },
}
