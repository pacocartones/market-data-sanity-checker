import type { MarketDataSet } from '../schema/market-data'
import type { Finding, QualityDimension, Severity } from '../report/types'

/**
 * The compare contract — the comparison engine's rules.
 *
 * Compare rules judge a PAIR of datasets telling the same story: same symbol,
 * two sources. They answer "do these feeds agree?" instead of "is this feed
 * plausible?". Same discipline as single-source rules: pure, total, cited
 * thresholds, one finding per occurrence (the engine collapses).
 */

export interface CompareRuleMeta {
  id: string
  severity: Severity
  dimension: QualityDimension
  description: string
  defaultParams: Record<string, number>
  references: string[]
}

export interface CompareContext {
  config: {
    severity: Severity
    params: Record<string, number>
  }
  /** Bars aligned by date: only dates present in BOTH sources, chronologically. */
  shared: Array<{ date: string; a: MarketDataSet['bars'][number]; b: MarketDataSet['bars'][number] }>
  /** Dates (YYYY-MM-DD) present only in source A / only in source B. */
  onlyInA: string[]
  onlyInB: string[]
}

export interface CompareRule {
  meta: CompareRuleMeta
  check(a: MarketDataSet, b: MarketDataSet, context: CompareContext): Finding[]
}

/** Per-compare-rule user overrides (same shape as single-source config). */
export interface CompareConfig {
  rules?: Record<string, { enabled?: boolean; severity?: Severity; params?: Record<string, number> }>
}
