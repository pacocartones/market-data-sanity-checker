import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * OHLC_INCONSISTENT — the four prices of a bar must satisfy low ≤ open ≤ high
 * and low ≤ close ≤ high. Real feeds break this: Yahoo delivered 2020.OL bars
 * with Close < Low after a double price adjustment (documented in yfinance's
 * price-repair notes). Comparisons are exact — real dirty data is gross, not
 * epsilon-sized. Bars with any non-finite field are skipped: that is
 * PRICE_NONPOSITIVE's job.
 */
export const ohlcInconsistent: Rule = {
  meta: {
    id: 'OHLC_INCONSISTENT',
    block: 'price',
    severity: 'critical',
    dimension: 'validity',
    description: 'high < low, or open/close outside the [low, high] range',
    defaultParams: {},
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const findings: Finding[] = []

    for (const bar of data.bars) {
      const { open, high, low, close } = bar
      if (![open, high, low, close].every(Number.isFinite)) continue

      const base = {
        rule: 'OHLC_INCONSISTENT',
        severity: context.config.severity,
        action: 'block',
        dimension: 'validity',
        where: { date: bar.timestamp },
        evidence: { open, high, low, close },
      } as const

      if (high < low) {
        findings.push({
          ...base,
          explanation:
            `High (${high}) is below low (${low}) on the same bar, which is structurally impossible: ` +
            `the session's highest trade cannot print below its lowest. ` +
            `Hypothesis: swapped or misaligned columns in the vendor feed. ` +
            `Block this bar and re-fetch it from the source.`,
        })
      }
      if (open < low || open > high) {
        findings.push({
          ...base,
          explanation:
            `Open (${open}) lies outside the session's [low, high] range ([${low}, ${high}]), ` +
            `which is impossible for a real opening trade. ` +
            `Hypothesis: a vendor adjustment bug — Yahoo's 2020.OL incident delivered prices outside ` +
            `their own range after a double adjustment. Block this bar and re-fetch it from the source.`,
        })
      }
      if (close < low || close > high) {
        findings.push({
          ...base,
          explanation:
            `Close (${close}) lies outside the session's [low, high] range ([${low}, ${high}]), ` +
            `which is impossible for a real closing trade. ` +
            `Hypothesis: a vendor adjustment bug — Yahoo's 2020.OL incident delivered Close < Low ` +
            `after a double adjustment. Block this bar and re-fetch it from the source.`,
        })
      }
    }

    return findings
  },
}
