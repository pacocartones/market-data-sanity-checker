import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * ZERO_VOLUME_MOVED — zero volume but the price moved intraday (high != low).
 *
 * A price can only change when trades happen, so an intraday range with zero
 * reported volume is contradictory — unless the instrument was halted, and
 * halted sessions normally report high == low. Documented real cases (e.g.
 * 1COV.DE on Yahoo, see yfinance's price-repair notes) turned out to be
 * corrupt vendor rows, hence the WARNING: verify against the source.
 *
 * Bars without volume, with positive volume, or with non-finite prices are
 * ignored — absence of data is not evidence of contradiction.
 */
export const zeroVolumeMoved: Rule = {
  meta: {
    id: 'ZERO_VOLUME_MOVED',
    block: 'price',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Volume is zero but the price moved intraday (high != low)',
    defaultParams: {},
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const findings: Finding[] = []

    for (const bar of data.bars) {
      if (bar.volume !== 0) continue
      if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) continue
      if (bar.high === bar.low) continue

      findings.push({
        rule: 'ZERO_VOLUME_MOVED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: bar.timestamp },
        explanation:
          `Zero volume but the price moved intraday (high ${bar.high} != low ${bar.low}), which is ` +
          `contradictory unless the instrument was halted — and halted sessions usually report ` +
          `high == low. Documented real cases (e.g. 1COV.DE on Yahoo) turned out to be corrupt vendor ` +
          `rows; verify against the source before consuming.`,
        evidence: { high: bar.high, low: bar.low },
      })
    }

    return findings
  },
}
