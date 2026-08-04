import type { Finding } from '../../report/types'
import { isHampelOutlier, mad, median } from '../stats'
import type { Rule } from '../types'

/**
 * PRICE_SPIKE_INTRADAY — the isolated bad tick.
 *
 * The signature of a corrupt tick is the inverted V: the close lands far
 * outside its neighbourhood and REVERTS the next session. Documented case:
 * Berkshire Hathaway BRK.A on 3-Jun-2024, when an NYSE/SIP glitch printed it
 * at $185.15 (~−99.97%) and the next session it was back at ~$621,000. A jump
 * that does NOT revert is a real regime change — that is RETURN_SPIKE /
 * SPLIT_NOT_ADJUSTED territory — not a corrupt tick.
 *
 * Detection: Hampel filter (median ± θ·1.4826·MAD) over the surrounding
 * closes, excluding the candidate itself, plus an explicit next-session
 * reversal check AND a minimum economic deviation: a bad tick is a gross
 * error, not a statistical wiggle. As an economic anchor, clearly-erroneous
 * rules bust single-stock trades 10% (price ≤ $25), 5% ($25–$50) or 3%
 * (> $50) away from the reference price (FINRA Rule 11892). Our default band
 * (10%) deliberately EXCEEDS even the loosest tier — and far exceeds the 3%
 * large-cap tier — because a false positive here blocks a real datum: better
 * to miss a borderline tick and leave it to RETURN_SPIKE (warning) than to
 * cry wolf on a plausible move. The candidate must also be isolated: if the
 * previous bar is an outlier against the same neighbourhood, this is a
 * block-level shift (CURRENCY_SCALE_SUSPECT territory), not a tick. The first
 * and last bars are never candidates: an inverted V needs context on both
 * sides. Flat neighbourhoods (sigma = 0) are skipped: a perfectly flat series
 * is STALE_PRICE's problem, not ours.
 */
export const priceSpikeIntraday: Rule = {
  meta: {
    id: 'PRICE_SPIKE_INTRADAY',
    block: 'price',
    severity: 'critical',
    dimension: 'accuracy',
    description: 'Isolated bad tick: close far outside its neighbourhood that reverts the next session',
    defaultParams: {
      /** Closes taken on each side of the candidate to build its neighbourhood. */
      window: 5,
      /** Hampel threshold: robust sigmas beyond which a close is an outlier. */
      theta: 3,
      /**
       * Minimum distance from the neighbourhood median, as a fraction of it.
       * Clearly-erroneous tiers for single-stock events are 10% (≤ $25),
       * 5% ($25–$50) and 3% (> $50) — FINRA Rule 11892. The 0.10 default
       * deliberately exceeds the large-cap tier: conservative by design
       * (better a missed borderline tick than a false positive that blocks a
       * real datum); below it a move is plausible noise left to RETURN_SPIKE.
       */
      minDeviationPct: 0.1,
    },
    references: [
      'https://www.thestack.technology/nyse-glitch-cause/',
      'https://real-statistics.com/time-series-analysis/stochastic-processes/hampel-filter-outliers/',
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/11892',
    ],
  },

  check(data, context) {
    const { window, theta, minDeviationPct } = context.config.params as {
      window: number
      theta: number
      minDeviationPct: number
    }
    const findings: Finding[] = []
    const bars = data.bars

    // First and last bars are never candidates: an inverted V needs context
    // on both sides, and the reversal check needs a next session anyway.
    for (let index = 1; index < bars.length - 1; index += 1) {
      const current = bars[index]!
      if (!Number.isFinite(current.close)) continue

      // Neighbourhood: up to `window` closes on each side, excluding the
      // candidate itself and any close that is non-positive or non-finite.
      const from = Math.max(0, index - window)
      const to = Math.min(bars.length - 1, index + window)
      const neighbourhood: number[] = []
      for (let offset = from; offset <= to; offset += 1) {
        if (offset === index) continue
        const close = bars[offset]!.close
        if (Number.isFinite(close) && close > 0) neighbourhood.push(close)
      }
      if (neighbourhood.length < 3) continue

      const center = median(neighbourhood)
      const sigma = 1.4826 * mad(neighbourhood, center)
      if (sigma === 0) continue // flat series: nothing is an outlier here
      if (!isHampelOutlier(neighbourhood, current.close, theta)) continue

      // Isolation: the previous bar must sit INSIDE the neighbourhood band.
      // If it is an outlier too, the candidate belongs to a block-level shift
      // (e.g. a pence/pounds scale change) — that is CURRENCY_SCALE_SUSPECT's
      // job, and it explains it better. A true bad tick is isolated.
      const previous = bars[index - 1]!
      if (Number.isFinite(previous.close) && isHampelOutlier(neighbourhood, previous.close, theta)) {
        continue
      }

      // A bad tick is a gross error, not a statistical wiggle: require a
      // minimum economic deviation (clearly-erroneous anchor, FINRA 11892 —
      // our 10% band deliberately exceeds the 3% large-cap tier).
      const deviationPct = Math.abs(current.close - center) / center
      if (deviationPct < minDeviationPct) continue

      // Reversal: the next session must be back inside the neighbourhood
      // range. A jump that holds is a regime change, not a bad tick.
      const next = bars[index + 1]
      if (!next || !Number.isFinite(next.close) || next.close <= 0) continue
      if (Math.abs(next.close - center) > theta * sigma) continue

      findings.push({
        rule: 'PRICE_SPIKE_INTRADAY',
        severity: context.config.severity,
        action: 'block',
        dimension: 'accuracy',
        where: { date: current.timestamp },
        explanation:
          `Close of ${current.close} sits far outside its neighbourhood (median ${center}) and reverted to ` +
          `${next.close} the next session — the classic signature of a bad tick / feed error (e.g. Berkshire ` +
          `BRK.A on 3-Jun-2024, printed at $185.15 by an NYSE glitch, back at ~$621,000 the next day). ` +
          `Block the datum and verify it against a second source before consuming it.`,
        evidence: {
          close: current.close,
          neighborhood_median: center,
          deviation_pct: Number((deviationPct * 100).toFixed(2)),
          reverted_to: next.close,
        },
      })
    }

    return findings
  },
}
