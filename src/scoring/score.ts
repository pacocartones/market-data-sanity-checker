import type { Finding, Severity } from '../report/types'

/**
 * sanity_score = max(0, 100 - Σ penalties).
 *
 * Bands: 90-100 reliable · 70-89 usable with caution · 40-69 suspicious ·
 * below 40 not fit for production.
 *
 * Penalty per rule fires ONCE per dataset at its highest severity — 847 bars
 * with the same defect must not drive the score below zero; the finding
 * carries `occurrences` instead.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 40,
  warning: 15,
  info: 5,
}

export function computeSanityScore(findings: readonly Finding[]): number {
  const penalty = findings.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0)
  return Math.max(0, 100 - penalty)
}

export function summarize(findings: readonly Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const finding of findings) summary[finding.severity] = (summary[finding.severity] ?? 0) + 1
  return summary
}
