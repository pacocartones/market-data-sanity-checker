/**
 * Report model: the stable output contract of the tool (since v0.1).
 */

export type Severity = 'critical' | 'warning' | 'info'

/** What to do with the flagged datum: block it, flag it, or send it to manual review. */
export type RecommendedAction = 'block' | 'flag' | 'review'

/** DAMA-DMBOK data quality dimensions — the vocabulary data engineers already speak. */
export type QualityDimension =
  | 'completeness'
  | 'validity'
  | 'accuracy'
  | 'consistency'
  | 'timeliness'
  | 'uniqueness'

/**
 * Deterministic severity ranking (critical < warning < info), shared by the
 * rules engine, the compare engine and the CLI to sort findings and evaluate
 * gating thresholds.
 */
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

export interface Finding {
  /** Stable rule identifier, e.g. SPLIT_NOT_ADJUSTED. */
  rule: string
  severity: Severity
  action: RecommendedAction
  dimension: QualityDimension
  /** Where in the dataset the problem lives (e.g. { date: '2024-06-03' }). */
  where?: Record<string, string | number>
  /** Human-readable explanation with the causal hypothesis and the evidence behind it. */
  explanation: string
  evidence?: Record<string, unknown>
  /** URLs to the real-world incident or literature justifying the rule's threshold. */
  references?: string[]
  /** How many times this rule fired; a rule reports once per dataset. */
  occurrences?: number
}

export interface SanityReport {
  symbol: string
  source: string
  sanity_score: number
  findings: Finding[]
  /**
   * Per-severity count of DISTINCT rules that fired — not occurrences.
   * A rule that flags 847 bad bars appears once in `findings` and counts once
   * here; the 847 lives in that finding's `occurrences`.
   */
  summary: Record<Severity, number>
  generated_at: string
}
