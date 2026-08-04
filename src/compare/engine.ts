import type { MarketDataSet } from '../schema/market-data'
import type { Finding, Severity } from '../report/types'
import { SEVERITY_ORDER } from '../report/types'
import { ACTION_FOR_SEVERITY } from '../rules/engine'
import type { CompareConfig, CompareContext, CompareRule } from './types'
import { compareRegistry } from './registry'

/**
 * The comparison engine: aligns two datasets by date and runs the compare
 * corpus. Mirrors the single-source engine's discipline — per-rule config,
 * occurrence collapse, deterministic order — but on pairs of datasets.
 */

/**
 * Date key for alignment: the UTC calendar day of the timestamp.
 *
 * Parseable timestamps are normalized via Date.parse + toISOString, so two
 * sources describing the same market day in different formats or offsets
 * ('2024-01-02' vs '2024-01-02T15:30:00Z') align. Trade-off, accepted: the
 * key is the UTC day, so '2024-01-02T23:00:00-05:00' keys as '2024-01-03' —
 * for alignment the market day is what matters and connectors already deliver
 * clean YYYY-MM-DD, so normalization only affects non-canonical inputs
 * (2026-07-31 audit: the previous slice(0, 10) misaligned any datetime with
 * a time/offset suffix). Unparseable timestamps are returned raw and align
 * only by exact string equality.
 */
export function dateKey(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return timestamp
  return new Date(parsed).toISOString().slice(0, 10)
}

/** Builds the shared alignment context once per pair of datasets. */
export function buildCompareContext(a: MarketDataSet, b: MarketDataSet): Omit<CompareContext, 'config'> {
  const byDateA = new Map<string, MarketDataSet['bars'][number]>()
  const byDateB = new Map<string, MarketDataSet['bars'][number]>()
  for (const bar of a.bars) byDateA.set(dateKey(bar.timestamp), bar)
  for (const bar of b.bars) byDateB.set(dateKey(bar.timestamp), bar)

  const shared: CompareContext['shared'] = []
  const onlyInA: string[] = []
  const onlyInB: string[] = []

  for (const [date, barA] of byDateA) {
    const barB = byDateB.get(date)
    if (barB) shared.push({ date, a: barA, b: barB })
    else onlyInA.push(date)
  }
  for (const date of byDateB.keys()) {
    if (!byDateA.has(date)) onlyInB.push(date)
  }

  shared.sort((x, y) => x.date.localeCompare(y.date))
  onlyInA.sort()
  onlyInB.sort()
  return { shared, onlyInA, onlyInB }
}

function collapseCompare(
  rule: CompareRule,
  occurrences: Finding[],
  forcedSeverity?: Severity,
): Finding {
  const representative = occurrences[0]!
  const severity = forcedSeverity ?? representative.severity
  return {
    ...representative,
    rule: rule.meta.id,
    severity,
    action: ACTION_FOR_SEVERITY[severity],
    dimension: rule.meta.dimension,
    references: rule.meta.references,
    occurrences: occurrences.length,
  }
}

export function runCompareRules(a: MarketDataSet, b: MarketDataSet, config: CompareConfig = {}): Finding[] {
  const alignment = buildCompareContext(a, b)
  const findings: Finding[] = []

  for (const rule of compareRegistry) {
    const override = config.rules?.[rule.meta.id]
    if (override?.enabled === false) continue
    const context: CompareContext = {
      config: {
        severity: override?.severity ?? rule.meta.severity,
        params: { ...rule.meta.defaultParams, ...override?.params },
      },
      ...alignment,
    }
    let occurrences: Finding[]
    try {
      occurrences = rule.check(a, b, context)
    } catch (error) {
      throw new Error(
        `Compare rule ${rule.meta.id} threw — rules must be total functions: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (occurrences.length > 0) {
      findings.push(collapseCompare(rule, occurrences, override?.severity))
    }
  }

  return findings.sort(
    (x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || x.rule.localeCompare(y.rule),
  )
}
