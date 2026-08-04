import type { Finding } from '../../report/types'
import { matchSplitRatio } from '../helpers'
import type { Rule } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * SPLIT_NOT_ADJUSTED — the flagship check.
 *
 * A one-session move matching a common split ratio (−50%, −66.7%, −75%… or
 * +100%, +400% for reverse splits) with NO split registered in the data is
 * almost always a vendor that logged the split but never adjusted historical
 * prices — the single most common source of phantom "crashes" in free market
 * data (documented cases: MOB.ST on Yahoo, BCAN in yfinance issue #2002).
 *
 * Supporting evidence: unadjusted feeds usually leave volume unadjusted too,
 * so volume often jumps by the same factor the price fell.
 */
export const splitNotAdjusted: Rule = {
  meta: {
    id: 'SPLIT_NOT_ADJUSTED',
    block: 'price',
    severity: 'critical',
    dimension: 'accuracy',
    description: 'Price jump matching a split ratio with no split registered in the series',
    defaultParams: {
      /**
       * Max distance between the observed return and the split-implied
       * return, RELATIVE to the implied return (see matchSplitRatio): 0.05
       * accepts −47.5%…−52.5% for a 2:1. Split days carry elevated
       * volatility, so the band must scale with the jump — the old absolute
       * ±2pp missed real unadjusted splits that landed on noisy days.
       */
      tolerance: 0.05,
      /** A registered split within ±N days of the jump explains it away. */
      splitWindowDays: 3,
    },
    references: [
      'https://ranaroussi.github.io/yfinance/advanced/price_repair.html',
      'https://github.com/ranaroussi/yfinance/issues/2002',
    ],
  },

  check(data, context) {
    const { tolerance, splitWindowDays } = context.config.params as {
      tolerance: number
      splitWindowDays: number
    }
    const findings: Finding[] = []
    const splits = data.splits ?? []

    for (let index = 0; index < data.bars.length - 1; index += 1) {
      const previous = data.bars[index]!
      const current = data.bars[index + 1]!
      if (previous.close <= 0 || current.close <= 0) continue

      const observedReturn = current.close / previous.close - 1
      const ratio = matchSplitRatio(observedReturn, tolerance)
      if (!ratio) continue

      const jumpTime = Date.parse(current.timestamp)
      const explained = splits.some((split) => {
        const splitTime = Date.parse(split.exDate)
        return !Number.isNaN(splitTime) && Math.abs(splitTime - jumpTime) <= splitWindowDays * DAY_MS
      })
      if (explained) continue

      const volumeRatio =
        previous.volume && current.volume && previous.volume > 0
          ? current.volume / previous.volume
          : undefined

      findings.push({
        rule: 'SPLIT_NOT_ADJUSTED',
        severity: context.config.severity,
        action: 'block',
        dimension: 'accuracy',
        where: { date: current.timestamp },
        explanation:
          `Price moved ${(observedReturn * 100).toFixed(1)}% in one session, matching an unadjusted ${ratio} split, ` +
          `but no split is registered near this date. Hypothesis: the vendor recorded the split without adjusting ` +
          `historical prices.` +
          (volumeRatio !== undefined
            ? ` Supporting evidence: volume moved ${volumeRatio.toFixed(1)}× in the opposite direction, as unadjusted feeds typically do.`
            : ''),
        evidence: {
          return: Number(observedReturn.toFixed(4)),
          hypothesized_ratio: ratio,
          previous_close: previous.close,
          close: current.close,
          ...(volumeRatio !== undefined ? { volume_ratio: Number(volumeRatio.toFixed(2)) } : {}),
        },
      })
    }

    return findings
  },
}
