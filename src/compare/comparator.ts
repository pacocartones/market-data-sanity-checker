import type { MarketDataSet } from '../schema/market-data'
import type { Finding, Severity } from '../report/types'
import { computeSanityScore, summarize } from '../scoring/score'
import { runCompareRules, buildCompareContext } from './engine'
import type { CompareConfig } from './types'

/** The comparison report: how well two sources agree on one symbol. */
export interface ComparisonReport {
  symbol: string
  sources: [string, string]
  /** 0–100, built like the sanity_score: 100 − Σ severity penalties. */
  consistency_score: number
  compared_dates: number
  only_in: Record<string, number>
  findings: Finding[]
  summary: Record<Severity, number>
  generated_at: string
}

/**
 * Compares two datasets for the same symbol from different sources.
 * The datasets should come from different connectors (or files) — comparing
 * a source against itself is valid but boring.
 */
export function compareDatasets(
  a: MarketDataSet,
  b: MarketDataSet,
  config: CompareConfig = {},
): ComparisonReport {
  const findings = runCompareRules(a, b, config)
  const alignment = buildCompareContext(a, b)
  // Unique labels even when both sources share a name (two snapshots of one provider).
  const [labelA, labelB] =
    a.source === b.source ? [`${a.source} (A)`, `${b.source} (B)`] : [a.source, b.source]
  return {
    symbol: a.symbol,
    sources: [labelA, labelB],
    consistency_score: computeSanityScore(findings),
    compared_dates: alignment.shared.length,
    only_in: { [labelA]: alignment.onlyInA.length, [labelB]: alignment.onlyInB.length },
    findings,
    summary: summarize(findings),
    generated_at: new Date().toISOString(),
  }
}
