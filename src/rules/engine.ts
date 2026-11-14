import type { MarketDataSet } from '../schema/market-data'
import type { Finding, RecommendedAction, Severity } from '../report/types'
import { SEVERITY_ORDER } from '../report/types'
import { simpleReturns, mad, median } from './stats'
import { registry } from './registry'
import { divDuplicated } from './corporate/div-duplicated'
import { summarizeDuplicateDividends } from './corporate/div-duplicated-summary'
import type { CheckerConfig, DataProfile, Rule, RuleContext } from './types'

/** Severity → recommended action. Fixed mapping: the action is the severity's consequence. */
export const ACTION_FOR_SEVERITY: Record<Severity, RecommendedAction> = {
  critical: 'block',
  warning: 'flag',
  info: 'review',
}

/** Computes the shared statistical profile once per dataset. */
export function buildDataProfile(data: MarketDataSet): DataProfile {
  const closes = data.bars.map((bar) => bar.close)
  const returns = simpleReturns(closes)
  return {
    returns,
    medianReturn: median(returns),
    madReturn: mad(returns),
  }
}

function resolveContext(rule: Rule, config: CheckerConfig, profile: DataProfile): RuleContext | null {
  const override = config.rules?.[rule.meta.id]
  if (override?.enabled === false) return null
  return {
    config: {
      severity: override?.severity ?? rule.meta.severity,
      params: { ...rule.meta.defaultParams, ...override?.params },
    },
    profile,
  }
}

/**
 * Collapses a rule's occurrences into ONE finding: representative = highest
 * severity occurrence (first among ties), `occurrences` = total count. A rule
 * fires once per dataset — 847 bad bars must not produce 847 report lines nor
 * 847 penalties.
 *
 * Severity: without an override, the most severe occurrence wins regardless
 * of input order; a rule may still deliberately degrade a lighter case when
 * every occurrence is lighter. An explicit USER override in the config keeps
 * the first representative and forces all findings to one severity. The
 * action always follows the final severity, so the pair stays consistent.
 */
function collapse(rule: Rule, occurrences: Finding[], forcedSeverity?: Severity): Finding {
  const representative =
    forcedSeverity === undefined
      ? occurrences.reduce((highest, occurrence) =>
          SEVERITY_ORDER[occurrence.severity] < SEVERITY_ORDER[highest.severity] ? occurrence : highest,
        )
      : occurrences[0]!
  const severity = forcedSeverity ?? representative.severity
  return {
    ...representative,
    rule: rule.meta.id,
    severity,
    action: ACTION_FOR_SEVERITY[severity],
    dimension: rule.meta.dimension,
    references: rule.meta.references,
    occurrences: occurrences.reduce((count, occurrence) => count + (occurrence.occurrences ?? 1), 0),
  }
}

/**
 * Runs every enabled rule over the dataset and returns findings sorted
 * deterministically (severity, then rule id) — stable output for golden tests
 * and diffable reports.
 */
export function runRules(data: MarketDataSet, config: CheckerConfig = {}): Finding[] {
  const profile = buildDataProfile(data)
  const findings: Finding[] = []

  for (const rule of registry) {
    const context = resolveContext(rule, config, profile)
    if (!context) continue
    let occurrences: Finding[]
    try {
      if (rule === divDuplicated) {
        const summary = summarizeDuplicateDividends(data, context)
        occurrences = summary ? [summary] : []
      } else {
        occurrences = rule.check(data, context)
      }
    } catch (error) {
      throw new Error(
        `Rule ${rule.meta.id} threw — rules must be total functions: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    if (occurrences.length > 0) {
      findings.push(collapse(rule, occurrences, config.rules?.[rule.meta.id]?.severity))
    }
  }

  return findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule),
  )
}
