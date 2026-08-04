import type { Finding } from '../../report/types'
import type { Rule } from '../types'

/**
 * SPLIT_RATIO_IMPROBABLE — a split ratio that is extreme, near 1:1, or exactly 1:1.
 *
 * Real splits concentrate on common ratios (2:1, 3:2, 3:1, 4:1, 5:1, 10:1) and
 * reverse splits are a separate, rare regime (~100 of ~6,000 corporate actions,
 * per Barron's). GE's 1-for-8 reverse split (Aug 2021) is legitimate and must
 * NOT fire; GEVO's 1-for-20 (2018, with CUSIP change) is extreme but real, and
 * 20-for-1 splits exist too — Amazon (AMZN, Jun 2022) and Alphabet (GOOGL,
 * Jul 2022) — so the verdict is 'verify against the issuer announcement',
 * never 'impossible'. An exactly 1:1 ratio is not a split at all.
 *
 * A near-1:1 ratio was long read as a typo signature, but the 2026-07-31 audit
 * found it is the classic SPIN-OFF signature: vendors (Yahoo among them) encode
 * spin-offs as fractional splits, and a spin-off's ratio (child value per
 * parent share) is non-round and near 1 — HON's 1907:2000, on this project's
 * own calibration scoreboard, is a real spin-off. That occurrence is degraded
 * to 'info' on purpose: a verification note, not a defect accusation.
 */
export const splitRatioImprobable: Rule = {
  meta: {
    id: 'SPLIT_RATIO_IMPROBABLE',
    block: 'corporate',
    severity: 'warning',
    dimension: 'validity',
    description: 'Split ratio is extreme, near 1:1 (probable spin-off), or exactly 1:1',
    defaultParams: {
      /** Ratio at or beyond this value (in either direction) is extreme and must be verified. */
      extremeRatio: 20,
      /** A ratio within this distance of exactly 1:1 is a typo signature. */
      nearOneTolerance: 0.05,
    },
    references: [
      'https://www.ge.com/news/press-releases/ge-announces-effective-date-for-reverse-stock-split',
      'https://www.barrons.com/articles/ge-announced-tons-wednesday-this-was-the-real-bombshell-51615389095',
      'https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2018-98',
    ],
  },

  check(data, context) {
    const { extremeRatio, nearOneTolerance } = context.config.params as {
      extremeRatio: number
      nearOneTolerance: number
    }
    const findings: Finding[] = []

    for (const split of data.splits ?? []) {
      const { numerator, denominator } = split
      if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        numerator <= 0 ||
        denominator <= 0
      ) {
        continue
      }

      const ratio = numerator / denominator
      let reason: 'identity' | 'near_one' | 'extreme' | undefined
      if (ratio === 1) {
        reason = 'identity'
      } else if (Math.abs(numerator - denominator) <= nearOneTolerance * denominator) {
        // Cross-multiplied |ratio − 1| ≤ tolerance: dividing first loses the
        // boundary case to float rounding (21/20 − 1 > 0.05 in IEEE 754).
        reason = 'near_one'
      } else if (ratio >= extremeRatio || ratio <= 1 / extremeRatio) {
        reason = 'extreme'
      }
      if (reason === undefined) continue

      const explanation =
        reason === 'identity'
          ? `Split ${numerator}-for-${denominator} on ${split.exDate} is exactly 1:1 — a ratio of 1 ` +
            `changes nothing, so this is not a corporate action but almost certainly a data-entry or ` +
            `feed-mapping error. Real splits cluster on round ratios (2:1, 3:2, 3:1, 10:1). Verify ` +
            `against the issuer's announcement and remove the record.`
          : reason === 'near_one'
            ? `Split ${numerator}-for-${denominator} on ${split.exDate} has ratio ${ratio} — within ` +
              `${nearOneTolerance} of exactly 1:1. This is probably a spin-off recorded as a split: ` +
              `spin-offs generate non-round ratios near 1 (the child's value per parent share), and ` +
              `vendors such as Yahoo encode them as fractional splits — HON's 1907:2000 is a documented ` +
              `case. Verify against the issuer's announcement before adjusting prices.`
            : `Split ${numerator}-for-${denominator} on ${split.exDate} has an extreme ratio of ${ratio} ` +
              `(at or beyond ${extremeRatio}:1). Such splits exist — Amazon (AMZN) and Alphabet (GOOGL) ` +
              `both split 20-for-1 (Jun/Jul 2022), GEVO's 1-for-20 reverse split (2018, with CUSIP ` +
              `change) was real, and GE's 1-for-8 (Aug 2021) was legitimate — but reverse splits are ` +
              `rare (~100 of ~6,000 corporate actions, Barron's) and a dropped or extra digit in the ` +
              `feed produces exactly this signature. Possible, but verify against the issuer's ` +
              `announcement before adjusting prices.`

      findings.push({
        rule: 'SPLIT_RATIO_IMPROBABLE',
        // Deliberate 'info' for near-1:1: a probable spin-off, not a defect.
        severity: reason === 'near_one' ? 'info' : context.config.severity,
        action: 'flag',
        dimension: 'validity',
        where: { date: split.exDate },
        explanation,
        evidence: { numerator, denominator, ratio, reason },
      })
    }

    return findings
  },
}
