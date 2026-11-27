/**
 * Two-source calibration: the pure half of `pnpm calibrate --two-source`.
 *
 * Every single-source finding on real Yahoo data is checked against a second provider (Alpha Vantage,
 * free key) and classified:
 *
 * - corroborated: the same rule fires on the Alpha Vantage series at the same date, or the compare
 *   engine finds a disagreement between the two series at that date;
 * - contradicted: Alpha Vantage has a clean bar at that date (no comparable rule fires there) and the
 *   compare engine finds no disagreement there;
 * - not_comparable: the rule needs data the Alpha Vantage free tier does not provide (dividends,
 *   splits, adjustment factors, fundamentals, metadata), the finding has no date, the date is outside
 *   the overlap of the two series, or the second source cannot settle it at that date (no bar there, or
 *   a different comparable rule fires there).
 *
 * Nothing in this file touches the network: the runner (scripts/calibrate-two-source.ts) fetches and
 * hands the datasets in, so the classification and the output shape are unit-tested on hand-made
 * inputs (tests/two-source-calibration.test.ts).
 */
import { ConnectorError } from '../src/connectors/types'
import { checkMarketData } from '../src/checker'
import { buildDataProfile } from '../src/rules/engine'
import { registry } from '../src/rules/registry'
import { buildCompareContext, dateKey } from '../src/compare/engine'
import { compareRegistry } from '../src/compare/registry'
import { compareDatasets } from '../src/compare/comparator'
import type { CompareConfig } from '../src/compare/types'
import type { Finding, Severity } from '../src/report/types'
import type { MarketDataSet } from '../src/schema/market-data'

/**
 * The fixed two-source basket: 24 symbols from the 50-symbol calibration list, one Alpha Vantage
 * request each, so a run stays under the free key's 25 requests per day with one request to spare.
 * A mix of every group in that list, so the compare covers different volatility, dividend and volume
 * profiles:
 * - mega-cap tech (5): high volume, earnings-driven return spikes;
 * - dividend payers (5): regular ex-dates inside any 100-session window;
 * - financials (5): includes BRK-B, the share-class symbol whose spelling differs between providers;
 * - industrials (4): mid volatility, mixed dividend schedules;
 * - ETFs (5): equity index, small caps, gold and long bonds.
 * Order matters: if the daily cap is lowered (ALPHA_VANTAGE_DAILY_LIMIT), the tail is skipped first,
 * so the groups are interleaved to keep the skipped part mixed too.
 */
export const TWO_SOURCE_SYMBOLS = [
  'AAPL', 'KO', 'JPM', 'GE', 'SPY',
  'MSFT', 'PG', 'BAC', 'CAT', 'QQQ',
  'NVDA', 'JNJ', 'GS', 'BA', 'IWM',
  'AMZN', 'XOM', 'V', 'UNP', 'GLD',
  'TSLA', 'VZ', 'BRK-B', 'TLT',
] as const

/** Yahoo range for the two-source mode: about 125 sessions, enough to cover Alpha Vantage's latest 100. */
export const YAHOO_TWO_SOURCE_RANGE = '6mo'

export type Classification = 'corroborated' | 'contradicted' | 'not_comparable'

export type NotComparableReason =
  | 'needs-dividends'
  | 'needs-splits'
  | 'needs-adjustment-factors'
  | 'needs-fundamentals'
  | 'needs-metadata'
  | 'no-date'
  | 'outside-overlap'
  | 'no-second-source-bar'
  | 'second-source-not-clean'

/**
 * Single-source rules the Alpha Vantage free tier cannot confirm or refute, by design: it returns the
 * latest 100 unadjusted daily bars with no dividends, no splits, no adjustment factors, no fundamentals
 * and no currency, exchange or identifiers. SPLIT_NOT_ADJUSTED is here too: it reads registered splits,
 * and an unadjusted second series shows every real split as a jump, so agreement would mean nothing.
 */
export const NOT_COMPARABLE_RULES: Readonly<Record<string, NotComparableReason>> = {
  DIV_DUPLICATED: 'needs-dividends',
  EXDATE_AFTER_PAYDATE: 'needs-dividends',
  EXDATE_MISPLACED: 'needs-dividends',
  DIV_NOT_ADJUSTED: 'needs-dividends',
  DIV_SCALE_100X: 'needs-dividends',
  DIV_YIELD_IMPOSSIBLE: 'needs-dividends',
  DIV_SPECIAL_MISCLASSIFIED: 'needs-dividends',
  SPLIT_RATIO_IMPROBABLE: 'needs-splits',
  SPLIT_NOT_ADJUSTED: 'needs-splits',
  CORPORATE_ACTION_MISSING_FROM_FACTOR: 'needs-adjustment-factors',
  MARKETCAP_MISMATCH: 'needs-fundamentals',
  PAYOUT_IMPOSSIBLE: 'needs-fundamentals',
  PE_EPS_INCOMPATIBLE: 'needs-fundamentals',
  FUNDAMENTALS_SIGN_VALIDITY: 'needs-fundamentals',
  CURRENCY_SUSPECT: 'needs-metadata',
  SYMBOL_MAPPING_SUSPECT: 'needs-metadata',
  DIVIDEND_FX_MISMATCH: 'needs-metadata',
}

/**
 * Compare rules switched off in two-source mode: Alpha Vantage free reports no dividends or splits, so
 * these would fire on every Yahoo corporate action and count as "disagreements" that are only a gap
 * in the free tier.
 */
export const DISABLED_COMPARE_RULES = ['DIVIDEND_MISMATCH', 'SPLIT_MISMATCH'] as const

const COMPARE_CONFIG: CompareConfig = {
  rules: Object.fromEntries(DISABLED_COMPARE_RULES.map((id) => [id, { enabled: false }])),
}

/** One occurrence of a rule, reduced to what the classification and the output need. */
export interface DatedFinding {
  rule: string
  severity: Severity
  /** Normalized YYYY-MM-DD, or null when the finding is about the whole series. */
  date: string | null
  explanation: string
}

/** Inclusive date window covered by both series. */
export interface Overlap {
  from: string
  to: string
}

export interface ClassificationInput {
  finding: DatedFinding
  overlap: Overlap | null
  /** Dates (YYYY-MM-DD) where the second source has a bar. */
  secondSourceDates: ReadonlySet<string>
  /** Single-source occurrences on the second source. */
  secondSourceFindings: readonly DatedFinding[]
  /** Compare-engine occurrences on the pair. */
  compareFindings: readonly DatedFinding[]
}

export type ClassificationResult =
  | { classification: 'corroborated'; basis: 'same-rule' | 'compare'; by: string }
  | { classification: 'contradicted' }
  | { classification: 'not_comparable'; reason: NotComparableReason }

export function isComparableRule(rule: string): boolean {
  return !Object.prototype.hasOwnProperty.call(NOT_COMPARABLE_RULES, rule)
}

/**
 * Classifies one first-source finding against the second source and the compare findings. Pure and
 * total; the order of checks is the documented precedence (calibration/README.md).
 */
export function classifyFinding(input: ClassificationInput): ClassificationResult {
  const { finding, overlap } = input
  if (!isComparableRule(finding.rule)) {
    return { classification: 'not_comparable', reason: NOT_COMPARABLE_RULES[finding.rule]! }
  }
  if (finding.date === null) return { classification: 'not_comparable', reason: 'no-date' }
  const date = finding.date
  if (overlap === null || date < overlap.from || date > overlap.to) {
    return { classification: 'not_comparable', reason: 'outside-overlap' }
  }

  const sameRule = input.secondSourceFindings.find((other) => other.rule === finding.rule && other.date === date)
  if (sameRule) return { classification: 'corroborated', basis: 'same-rule', by: sameRule.rule }

  const disagreement = input.compareFindings.find((other) => other.date === date)
  if (disagreement) return { classification: 'corroborated', basis: 'compare', by: disagreement.rule }

  if (!input.secondSourceDates.has(date)) return { classification: 'not_comparable', reason: 'no-second-source-bar' }

  const otherRule = input.secondSourceFindings.some((other) => other.date === date && isComparableRule(other.rule))
  if (otherRule) return { classification: 'not_comparable', reason: 'second-source-not-clean' }

  return { classification: 'contradicted' }
}

function findingDate(finding: Finding): string | null {
  const raw = finding.where?.date
  return typeof raw === 'string' && raw.length > 0 ? dateKey(raw) : null
}

function toDated(finding: Finding): DatedFinding {
  return { rule: finding.rule, severity: finding.severity, date: findingDate(finding), explanation: finding.explanation }
}

/**
 * Every single-source occurrence, not the collapsed report: the engine keeps one representative date
 * per rule, and calibration needs each date to compare it. Default config, same corpus as checkMarketData.
 */
export function singleSourceOccurrences(data: MarketDataSet): DatedFinding[] {
  const profile = buildDataProfile(data)
  const occurrences: DatedFinding[] = []
  for (const rule of registry) {
    const context = { config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } }, profile }
    for (const finding of rule.check(data, context)) {
      occurrences.push(toDated({ ...finding, rule: rule.meta.id }))
    }
  }
  return sortDated(occurrences)
}

/** Every compare-engine occurrence on the pair, with the two-source compare config. */
export function compareOccurrences(a: MarketDataSet, b: MarketDataSet): DatedFinding[] {
  const alignment = buildCompareContext(a, b)
  const disabled = new Set<string>(DISABLED_COMPARE_RULES)
  const occurrences: DatedFinding[] = []
  for (const rule of compareRegistry) {
    if (disabled.has(rule.meta.id)) continue
    const context = {
      config: { severity: rule.meta.severity, params: { ...rule.meta.defaultParams } },
      ...alignment,
    }
    for (const finding of rule.check(a, b, context)) {
      occurrences.push(toDated({ ...finding, rule: rule.meta.id }))
    }
  }
  return sortDated(occurrences)
}

function sortDated(findings: DatedFinding[]): DatedFinding[] {
  return findings.sort(
    (x, y) => (x.date ?? '').localeCompare(y.date ?? '') || x.rule.localeCompare(y.rule),
  )
}

/** First and last date present in BOTH series, or null when they share no date. */
export function computeOverlap(a: MarketDataSet, b: MarketDataSet): Overlap | null {
  const { shared } = buildCompareContext(a, b)
  if (shared.length === 0) return null
  return { from: shared[0]!.date, to: shared[shared.length - 1]!.date }
}

/** The dataset restricted to bars inside the overlap window (corporate actions too). */
export function trimToOverlap(data: MarketDataSet, overlap: Overlap): MarketDataSet {
  const inside = (date: string) => {
    const key = dateKey(date)
    return key >= overlap.from && key <= overlap.to
  }
  const trimmed: MarketDataSet = { ...data, bars: data.bars.filter((bar) => inside(bar.timestamp)) }
  if (data.dividends) trimmed.dividends = data.dividends.filter((dividend) => inside(dividend.exDate))
  if (data.splits) trimmed.splits = data.splits.filter((split) => inside(split.exDate))
  return trimmed
}

/**
 * Error text that is safe to write: ConnectorError messages are already categorized by the connectors
 * (the Alpha Vantage one never copies provider text), anything else becomes a fixed string, and the API
 * key is scrubbed from both in case a provider or runtime ever reflects it.
 */
export function safeErrorMessage(error: unknown, secrets: readonly (string | undefined)[] = []): string {
  return redactSecrets(error instanceof ConnectorError ? error.message : 'request failed (details withheld)', secrets)
}

/** Replaces every occurrence of each non-empty secret with [redacted]. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length > 0) out = out.split(secret).join('[redacted]')
  }
  return out
}

export interface ClassifiedFinding extends DatedFinding {
  classification: Classification
  basis?: 'same-rule' | 'compare'
  by?: string
  reason?: NotComparableReason
}

export interface RuleSummary {
  fired: number
  corroborated: number
  contradicted: number
  not_comparable: number
}

export interface TwoSourceSymbolResult {
  symbol: string
  bars: { yahoo: number; alpha_vantage: number }
  sanity_score: { yahoo: number; alpha_vantage: number }
  overlap: (Overlap & { sessions: number; yahoo_only: number; alpha_vantage_only: number }) | null
  consistency_score: number | null
  findings: ClassifiedFinding[]
  alpha_vantage_findings: DatedFinding[]
  compare_findings: DatedFinding[]
}

export interface TwoSourcePair {
  symbol: string
  yahoo: MarketDataSet
  alphaVantage: MarketDataSet
}

export interface TwoSourceReport {
  generated_at: string
  mode: 'two-source'
  providers: ['yahoo', 'alpha-vantage']
  alpha_vantage_tier: 'free' | 'premium'
  range: { yahoo: string; alpha_vantage: string }
  symbols: string[]
  disabled_compare_rules: string[]
  results: TwoSourceSymbolResult[]
  skipped: Array<{ symbol: string; reason: 'daily-request-cap' }>
  failed: Array<{ symbol: string; provider: string; error: string }>
  summary: {
    symbols_compared: number
    symbols_skipped: number
    symbols_failed: number
    totals: RuleSummary
    by_rule: Record<string, RuleSummary>
  }
}

function emptySummary(): RuleSummary {
  return { fired: 0, corroborated: 0, contradicted: 0, not_comparable: 0 }
}

/** Runs checks and compare on one fetched pair and classifies every Yahoo occurrence. */
export function analyzePair(pair: TwoSourcePair): TwoSourceSymbolResult {
  const yahooFindings = singleSourceOccurrences(pair.yahoo)
  const avFindings = singleSourceOccurrences(pair.alphaVantage)
  const overlap = computeOverlap(pair.yahoo, pair.alphaVantage)

  let compareFindings: DatedFinding[] = []
  let consistency: number | null = null
  let overlapOut: TwoSourceSymbolResult['overlap'] = null
  if (overlap) {
    const yahooWindow = trimToOverlap(pair.yahoo, overlap)
    const avWindow = trimToOverlap(pair.alphaVantage, overlap)
    compareFindings = compareOccurrences(yahooWindow, avWindow)
    consistency = compareDatasets(yahooWindow, avWindow, COMPARE_CONFIG).consistency_score
    const alignment = buildCompareContext(yahooWindow, avWindow)
    overlapOut = {
      ...overlap,
      sessions: alignment.shared.length,
      yahoo_only: alignment.onlyInA.length,
      alpha_vantage_only: alignment.onlyInB.length,
    }
  }

  const secondSourceDates = new Set(pair.alphaVantage.bars.map((bar) => dateKey(bar.timestamp)))
  const findings: ClassifiedFinding[] = yahooFindings.map((finding) => ({
    ...finding,
    ...classifyFinding({
      finding,
      overlap,
      secondSourceDates,
      secondSourceFindings: avFindings,
      compareFindings,
    }),
  }))

  return {
    symbol: pair.symbol,
    bars: { yahoo: pair.yahoo.bars.length, alpha_vantage: pair.alphaVantage.bars.length },
    sanity_score: {
      yahoo: checkMarketData(pair.yahoo).sanity_score,
      alpha_vantage: checkMarketData(pair.alphaVantage).sanity_score,
    },
    overlap: overlapOut,
    consistency_score: consistency,
    findings,
    alpha_vantage_findings: avFindings,
    compare_findings: compareFindings,
  }
}

export interface BuildTwoSourceReportInput {
  generatedAt: string
  symbols: readonly string[]
  pairs: readonly TwoSourcePair[]
  skipped: readonly string[]
  /** Already redacted with safeErrorMessage. */
  failed: ReadonlyArray<{ symbol: string; provider: string; error: string }>
  alphaVantageTier?: 'free' | 'premium'
}

/** Builds calibration/two-source.json from fetched pairs. Pure apart from what the rules compute. */
export function buildTwoSourceReport(input: BuildTwoSourceReportInput): TwoSourceReport {
  const results = input.pairs.map(analyzePair)
  const totals = emptySummary()
  const byRule: Record<string, RuleSummary> = {}
  for (const result of results) {
    for (const finding of result.findings) {
      const entry = (byRule[finding.rule] ??= emptySummary())
      entry.fired += 1
      entry[finding.classification] += 1
      totals.fired += 1
      totals[finding.classification] += 1
    }
  }
  const sortedByRule = Object.fromEntries(Object.entries(byRule).sort(([x], [y]) => x.localeCompare(y)))

  return {
    generated_at: input.generatedAt,
    mode: 'two-source',
    providers: ['yahoo', 'alpha-vantage'],
    alpha_vantage_tier: input.alphaVantageTier ?? 'free',
    range: { yahoo: YAHOO_TWO_SOURCE_RANGE, alpha_vantage: 'compact (latest 100 sessions)' },
    symbols: [...input.symbols],
    disabled_compare_rules: [...DISABLED_COMPARE_RULES],
    results,
    skipped: input.skipped.map((symbol) => ({ symbol, reason: 'daily-request-cap' as const })),
    failed: input.failed.map(({ symbol, provider, error }) => ({ symbol, provider, error })),
    summary: {
      symbols_compared: results.length,
      symbols_skipped: input.skipped.length,
      symbols_failed: new Set(input.failed.map((entry) => entry.symbol)).size,
      totals,
      by_rule: sortedByRule,
    },
  }
}
