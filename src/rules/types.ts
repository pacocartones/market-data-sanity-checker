import type { MarketDataSet } from '../schema/market-data'
import type { Finding, QualityDimension, Severity } from '../report/types'

/**
 * The rule contract — the heart of the project.
 *
 * A rule is a pure, total function with declarative metadata. Rules never
 * throw (degenerate datasets are a fact of life), never mutate the input
 * (flag, don't delete), and always explain themselves. Adding a rule means
 * adding one file and one registry entry — the corpus is the moat.
 */

export type RuleBlock = 'price' | 'corporate' | 'fundamentals' | 'metadata'

export interface RuleMeta {
  /** Stable identifier, SCREAMING_SNAKE_CASE. Part of the public report contract. */
  id: string
  block: RuleBlock
  /** Default severity; users can override it via config. */
  severity: Severity
  /** DAMA data quality dimension. */
  dimension: QualityDimension
  /** One-line description shown by `mdsc rules`. */
  description: string
  /**
   * Default thresholds. Every number a rule uses must live here so users can
   * override it and every default must have a citation in `references`.
   */
  defaultParams: Record<string, number>
  /** URLs to the real-world incident or literature justifying the rule and its thresholds. */
  references: string[]
}

/** Statistics computed once per dataset by the engine and shared with all rules. */
export interface DataProfile {
  /** Simple returns between consecutive closes, as given (never re-sorted). Length = bars − 1. */
  returns: number[]
  medianReturn: number
  /** Median absolute deviation of returns. */
  madReturn: number
}

export interface ResolvedRuleConfig {
  severity: Severity
  params: Record<string, number>
}

export interface RuleContext {
  config: ResolvedRuleConfig
  profile: DataProfile
}

export interface Rule {
  meta: RuleMeta
  /**
   * Returns one finding per occurrence. The engine collapses them into a
   * single report entry with `occurrences` — rules should NOT self-collapse.
   *
   * Findings normally carry `context.config.severity`. A rule MAY deliberately
   * emit a lower severity for a lighter sub-case (e.g. CURRENCY_SUSPECT
   * degrades "currency absent" to info): the engine preserves that choice
   * unless the user overrides the rule's severity in the config.
   */
  check(data: MarketDataSet, context: RuleContext): Finding[]
}

/** Per-rule user overrides. */
export interface RuleOverride {
  enabled?: boolean
  severity?: Severity
  params?: Record<string, number>
}

export interface CheckerConfig {
  rules?: Record<string, RuleOverride>
}
