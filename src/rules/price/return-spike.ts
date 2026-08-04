import type { Finding } from '../../report/types'
import { matchSplitRatio } from '../helpers'
import { modifiedZScore } from '../stats'
import type { Rule } from '../types'

/**
 * RETURN_SPIKE — statistical outlier detection on daily returns.
 *
 * Modified z-score (Iglewicz & Hoaglin): |M| > 3.5 flags returns no robust
 * model of the series can explain. Deliberately a WARNING, not a critical:
 * real crashes exist, and this tool flags for review — it never judges a move
 * to be impossible.
 *
 * Semantic dedup: returns matching a common split ratio are skipped — that is
 * SPLIT_NOT_ADJUSTED's job, and it explains them better.
 *
 * Dual gate: a spike must be BOTH statistically anomalous AND economically
 * large (|return| ≥ minReturnPct). Without the economic gate, every real
 * market panic (a −2.7% day in SPY) gets flagged, and a trust tool that
 * cries wolf on ordinary volatility loses credibility — the same philosophy
 * as PRICE_SPIKE_INTRADAY's clearly-erroneous band. Calibration on 50 real
 * Yahoo symbols (2026-07) confirmed the gate is needed.
 *
 * Severity tiering (2026-07-31 audit: 33 of the 50 clean symbols in our own
 * scoreboard were still penalized by ordinary earnings moves — the dual gate
 * alone was not enough): a spike with |z| ≥ 5 OR |return| ≥ 8% keeps the
 * configured severity; a milder outlier (past the z > 3.5 and ≥ 4% gates but
 * below both caps) is deliberately degraded to 'info' — statistically
 * anomalous, but within ordinary earnings-move magnitude and not worth a
 * warning. The engine preserves this deliberate severity unless the user
 * overrides the rule's severity.
 */

/** |modified z-score| at or above which a spike keeps the rule's full severity. */
const FULL_SEVERITY_ZSCORE = 5
/** |return| at or above which a spike keeps the rule's full severity. */
const FULL_SEVERITY_RETURN = 0.08

export const returnSpike: Rule = {
  meta: {
    id: 'RETURN_SPIKE',
    block: 'price',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'Daily return is a robust statistical outlier (modified z-score) with no corporate action',
    defaultParams: {
      /** |modified z-score| above which a return is an outlier (Iglewicz & Hoaglin). */
      zscoreThreshold: 3.5,
      /** Minimum returns required before the statistics are meaningful. */
      minReturns: 10,
      /**
       * Split-ratio tolerance for the semantic dedup against SPLIT_NOT_ADJUSTED
       * (relative to the implied return — same contract as matchSplitRatio).
       */
      splitTolerance: 0.05,
      /**
       * Economic gate: minimum |return| to evaluate. Real market panics (−2.7%
       * days in index ETFs) are statistically anomalous but economically
       * ordinary — below ~4% a daily move needs no explanation.
       */
      minReturnPct: 0.04,
    },
    references: ['https://statsolvepro.com/outlier-detection-methods/'],
  },

  check(data, context) {
    const { zscoreThreshold, minReturns, splitTolerance, minReturnPct } = context.config.params as {
      zscoreThreshold: number
      minReturns: number
      splitTolerance: number
      minReturnPct: number
    }
    const { medianReturn, madReturn, returns } = context.profile
    if (returns.length < minReturns) return []

    const findings: Finding[] = []

    for (let index = 0; index < data.bars.length - 1; index += 1) {
      const previous = data.bars[index]!
      const current = data.bars[index + 1]!
      if (previous.close <= 0 || current.close <= 0) continue

      const observedReturn = current.close / previous.close - 1
      if (Math.abs(observedReturn) < minReturnPct) continue
      const zScore = modifiedZScore(observedReturn, medianReturn, madReturn)
      if (Math.abs(zScore) <= zscoreThreshold) continue
      if (matchSplitRatio(observedReturn, splitTolerance)) continue

      // Anti-cry-wolf tiering: past the gates but below BOTH full-severity
      // caps, the move is an ordinary earnings-scale outlier — degrade it to
      // 'info' so a warning keeps meaning "stop and look" (see rule JSDoc).
      const fullSeverity =
        Math.abs(zScore) >= FULL_SEVERITY_ZSCORE || Math.abs(observedReturn) >= FULL_SEVERITY_RETURN

      findings.push({
        rule: 'RETURN_SPIKE',
        severity: fullSeverity ? context.config.severity : 'info',
        action: 'flag',
        dimension: 'accuracy',
        where: { date: current.timestamp },
        explanation:
          `Daily return of ${(observedReturn * 100).toFixed(1)}% is a statistical outlier (modified z-score ` +
          `${zScore.toFixed(1)}, threshold ${zscoreThreshold}) with no corporate action registered. It may be a real ` +
          `market move or a bad tick — verify against a second source before consuming it.` +
          (fullSeverity ? '' : ' (statistically anomalous but within ordinary earnings-move magnitude)'),
        evidence: {
          return: Number(observedReturn.toFixed(4)),
          modified_zscore: Number(zScore.toFixed(2)),
        },
      })
    }

    return findings
  },
}
