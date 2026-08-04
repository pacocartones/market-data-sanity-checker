import type { Rule } from '../types'
import { latestClose, sortedBars, trailingDividends } from '../series'

/**
 * DIV_YIELD_IMPOSSIBLE — trailing 12-month dividend yield above any
 * plausible bound.
 *
 * A sustained TTM yield above ~20% is almost always a data defect rather
 * than a payout policy — duplicated dividends, ×100 scale errors, or special
 * dividends mistagged as regular are the typical causes. Rare real cases do
 * exist (ZIM paid out ~110% TTM in 2022; Petrobras reached ~40%), so the
 * verdict is 'verify before trusting', never 'nonexistent' (2026-07-31
 * audit). The data-cleaning literature treats such yields as errors to
 * repair at the source, not as signals to trade.
 */
export const divYieldImpossible: Rule = {
  meta: {
    id: 'DIV_YIELD_IMPOSSIBLE',
    block: 'corporate',
    severity: 'warning',
    dimension: 'accuracy',
    description: 'Trailing 12-month dividend yield above a plausible bound',
    defaultParams: {
      /** Max plausible trailing 12-month dividend yield (TTM regular dividends / latest close). */
      maxAnnualYieldPct: 0.2,
    },
    references: ['https://quantpedia.com/working-with-high-frequency-tick-data-cleaning-the-data/'],
  },

  check(data, context) {
    const { maxAnnualYieldPct } = context.config.params as { maxAnnualYieldPct: number }
    const sorted = sortedBars(data.bars)
    const lastBar = sorted[sorted.length - 1]
    const close = latestClose(sorted)
    if (lastBar === undefined || close === undefined) return []

    const refDate = lastBar.timestamp
    const ttm = trailingDividends(data.dividends ?? [], refDate, 365, 'regular')
    const ttmYield = ttm / close
    if (!(ttmYield > maxAnnualYieldPct)) return []

    return [
      {
        rule: 'DIV_YIELD_IMPOSSIBLE',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'accuracy',
        where: { date: refDate },
        explanation:
          `Trailing 12-month regular dividends sum to ${ttm} against a latest close of ${close} — a ` +
          `${(ttmYield * 100).toFixed(1)}% yield, above the ${maxAnnualYieldPct * 100}% plausibility bound. ` +
          `Yields this high are almost always a data defect (duplicated dividends, ×100 scale errors, ` +
          `specials mistagged as regular) — though rare real cases exist (ZIM paid out ~110% TTM in 2022), ` +
          `so verify before trusting. Review the dividend history for the window ending ${refDate} before ` +
          `using any yield or total-return figure.`,
        evidence: {
          ttm_dividends: ttm,
          close,
          ttm_yield_pct: ttmYield,
        },
      },
    ]
  },
}
