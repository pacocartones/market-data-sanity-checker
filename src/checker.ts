import type { MarketDataSet } from './schema/market-data'
import type { SanityReport } from './report/types'
import { runRules } from './rules/engine'
import { computeSanityScore, summarize } from './scoring/score'
import type { CheckerConfig } from './rules/types'

/**
 * The public SDK entry point: runs the full rule corpus over a dataset and
 * returns the sanity report. The dataset must already conform to the schema —
 * validate unknown input with `marketDataSetSchema.safeParse` first.
 */
export function checkMarketData(data: MarketDataSet, config: CheckerConfig = {}): SanityReport {
  const findings = runRules(data, config)
  return {
    symbol: data.symbol,
    source: data.source,
    sanity_score: computeSanityScore(findings),
    findings,
    summary: summarize(findings),
    generated_at: new Date().toISOString(),
  }
}
