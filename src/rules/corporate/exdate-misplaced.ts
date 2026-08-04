import type { Finding } from '../../report/types'
import { barIndexOnOrBefore, sortedBars } from '../series'
import type { Rule } from '../types'

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * EXDATE_MISPLACED — no price drop on the registered ex-date, but a matching
 * drop a few sessions later.
 *
 * On the ex-date the price should fall by roughly the dividend amount: if the
 * close barely moves on the registered ex-date but a drop of the expected size
 * appears days later, the vendor most likely registered the ex-date on the
 * wrong session. Documented case: TETY.ST on Yahoo, where the dividend sits on
 * a date with no price drop and the real drop follows days later.
 *
 * Conservative by design: if no matching drop is found nearby the rule stays
 * silent — the drop may simply be missing from the series. And dividends
 * whose expected drop is below `minExpectedDropPct` are skipped entirely:
 * a 0.3% ex-date drop is indistinguishable from daily noise, so judging its
 * absence would only produce false positives.
 */
export const exdateMisplaced: Rule = {
  meta: {
    id: 'EXDATE_MISPLACED',
    block: 'corporate',
    severity: 'warning',
    dimension: 'consistency',
    description: 'No price drop on the registered ex-date, but a matching drop days later',
    defaultParams: {
      /** How many sessions after the registered ex-date to search for the real drop. */
      searchWindowSessions: 30,
      /** A drop counts as "the dividend" once it reaches this fraction of the expected drop. */
      minMatchRatio: 0.5,
      /** A drop beyond this multiple of the expected drop is too large to be the dividend. */
      maxMatchRatio: 2,
      /**
       * Minimum expected drop (dividend / price) to evaluate. Below ~2% the
       * ex-date drop hides inside ordinary daily volatility (±1% daily moves
       * are routine) and its "absence" proves nothing — calibration on 50
       * real Yahoo symbols (2026-07) showed noise-matched false positives at
       * 1–1.7%, while the documented case (TETY.ST, 4.2%) sits far above.
       */
      minExpectedDropPct: 0.02,
    },
    references: ['https://ranaroussi.github.io/yfinance/advanced/price_repair.html'],
  },

  check(data, context) {
    const { searchWindowSessions, minMatchRatio, maxMatchRatio, minExpectedDropPct } = context.config
      .params as {
      searchWindowSessions: number
      minMatchRatio: number
      maxMatchRatio: number
      minExpectedDropPct: number
    }
    const findings: Finding[] = []
    const dividends = data.dividends ?? []
    const sorted = sortedBars(data.bars)

    for (const dividend of dividends) {
      if (!(dividend.amount > 0)) continue
      const index = barIndexOnOrBefore(sorted, dividend.exDate)
      if (index < 1) continue
      const previousClose = sorted[index - 1]!.close
      const exClose = sorted[index]!.close
      if (!isPositiveFinite(previousClose) || !isPositiveFinite(exClose)) continue

      const expectedDrop = dividend.amount / previousClose
      // Small dividends: the ex-date drop is inside daily noise — nothing to judge.
      if (expectedDrop < minExpectedDropPct) continue
      const actualDrop = previousClose / exClose - 1
      // The price did fall on the registered ex-date: the dividend is explained.
      if (actualDrop >= minMatchRatio * expectedDrop) continue

      const lastCandidate = Math.min(sorted.length - 1, index + searchWindowSessions)
      let matchedDate: string | undefined
      for (let j = index + 1; j <= lastCandidate; j += 1) {
        const before = sorted[j - 1]!.close
        const current = sorted[j]!.close
        if (!isPositiveFinite(before) || !isPositiveFinite(current)) continue
        const drop = before / current - 1
        if (drop >= minMatchRatio * expectedDrop && drop <= maxMatchRatio * expectedDrop) {
          matchedDate = sorted[j]!.timestamp
          break
        }
      }
      // No matching drop nearby: stay silent, the drop may be missing from the series.
      if (matchedDate === undefined) continue

      findings.push({
        rule: 'EXDATE_MISPLACED',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: dividend.exDate },
        explanation:
          `Dividend of ${dividend.amount} (ex-date ${dividend.exDate}) implies a ` +
          `${(expectedDrop * 100).toFixed(1)}% price drop on the ex-date, but the close moved only ` +
          `${(actualDrop * 100).toFixed(1)}% that session — while a matching drop appears on ${matchedDate}. ` +
          `Documented case: TETY.ST on Yahoo, where the dividend sits on a date with no price drop and the ` +
          `real drop follows days later. Hypothesis: the vendor registered the ex-date on the wrong session. ` +
          `Flag and verify the ex-date against the issuer's notice before adjusting prices.`,
        evidence: {
          expected_drop_pct: Number((expectedDrop * 100).toFixed(2)),
          actual_drop_pct: Number((actualDrop * 100).toFixed(2)),
          matched_date: matchedDate,
        },
      })
    }

    return findings
  },
}
