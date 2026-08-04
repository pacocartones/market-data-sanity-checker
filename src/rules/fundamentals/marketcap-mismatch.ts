import type { Finding } from '../../report/types'
import { latestClose, sortedBars } from '../series'
import type { Rule } from '../types'

/**
 * MARKETCAP_MISMATCH — marketCap incompatible with sharesOutstanding × price.
 *
 * Documented case: Alphabet (GOOGL), whose market cap showed up "totally
 * wrong" on CNBC and inconsistent across Nasdaq, WSJ and Yahoo
 * (Quant.SE #23085). The usual causes are a stale share count or a different
 * share definition per vendor (basic vs fully diluted — e.g. MSTR on Yahoo),
 * so the reported figure cannot be reconciled with the price series.
 */
export const marketcapMismatch: Rule = {
  meta: {
    id: 'MARKETCAP_MISMATCH',
    block: 'fundamentals',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'marketCap deviates from sharesOutstanding × latest close beyond tolerance',
    defaultParams: {
      /** Max relative deviation between reported marketCap and sharesOutstanding × close. */
      tolerancePct: 0.05,
    },
    references: [
      'https://quant.stackexchange.com/questions/23085/correct-alphabet-google-market-cap-calculation',
    ],
  },

  check(data, context) {
    const { tolerancePct } = context.config.params as { tolerancePct: number }
    const marketCap = data.fundamentals?.marketCap
    const sharesOutstanding = data.fundamentals?.sharesOutstanding
    if (
      marketCap === undefined ||
      !Number.isFinite(marketCap) ||
      marketCap <= 0 ||
      sharesOutstanding === undefined ||
      !Number.isFinite(sharesOutstanding) ||
      sharesOutstanding <= 0
    ) {
      return []
    }

    const sorted = sortedBars(data.bars)
    const close = latestClose(sorted)
    if (close === undefined || sorted.length === 0) return []

    const implied = sharesOutstanding * close
    const deviation = Math.abs(marketCap - implied) / marketCap
    if (deviation <= tolerancePct) return []

    const lastBar = sorted[sorted.length - 1]!
    const deviationPct = Math.round(deviation * 10000) / 100
    const findings: Finding[] = [
      {
        rule: 'MARKETCAP_MISMATCH',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: lastBar.timestamp },
        explanation:
          `Reported marketCap of ${marketCap} deviates ${deviationPct}% from sharesOutstanding × latest close ` +
          `(implied ${implied}). Documented case: Alphabet's market cap appeared "totally wrong" on CNBC and ` +
          `inconsistent across Nasdaq/WSJ/Yahoo (Quant.SE #23085) — typically a stale share count or a ` +
          `different share definition (basic vs fully diluted, e.g. MSTR on Yahoo). Verify both fields ` +
          `against the issuer's latest filing and correct whichever is wrong.`,
        evidence: {
          marketCap,
          implied_market_cap: implied,
          deviation_pct: deviationPct,
        },
      },
    ]
    return findings
  },
}
