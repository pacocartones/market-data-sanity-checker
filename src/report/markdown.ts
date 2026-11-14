import type { Finding, SanityReport } from './types'
import type { ComparisonReport } from '../compare/comparator'

export function escapeCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

// The backslash must be doubled before the other escapes are added, otherwise an
// escape sequence would escape the backslash that was inserted after it.
const HEADING_ESCAPES: ReadonlyArray<readonly [string, string]> = [
  ['\\', '\\\\'],
  ['[', '\\['],
  [']', '\\]'],
  ['<', '\\<'],
  ['>', '\\>'],
  ['&', '\\&'],
  ['`', '\\`'],
  ['*', '\\*'],
  ['_', '\\_'],
  ['|', '\\|'],
]

/**
 * Escapes a value interpolated into the `##` heading line, which has no cell
 * boundaries to contain it: `escapeCell` only neutralises pipes and line breaks,
 * so a symbol or source that carries a break could leave the heading and emit a
 * live link or raw HTML into the PR comment or `GITHUB_STEP_SUMMARY` that renders
 * this output. Brings the value onto one line and escapes the Markdown and HTML
 * punctuation that can start a construct.
 */
export function escapeHeading(value: string): string {
  let out = value.replaceAll(/[\r\n]+/g, ' ')
  for (const [from, to] of HEADING_ESCAPES) out = out.replaceAll(from, to)
  return out
}

function formatDate(where: Finding['where']): string {
  if (!where || where.date === undefined || where.date === null) return '-'
  return String(where.date)
}

/** Renders a single-source SanityReport as Markdown suitable for PR comments or GITHUB_STEP_SUMMARY. */
export function renderReportMarkdown(report: SanityReport): string {
  const lines: string[] = []
  lines.push(`## ${escapeHeading(report.symbol)} (${escapeHeading(report.source)}) — sanity_score: ${report.sanity_score}/100`)
  lines.push('')
  if (report.findings.length === 0) {
    lines.push('No findings.')
  } else {
    lines.push('| Rule | Severity | Date | Explanation |')
    lines.push('|---|---|---|---|')
    for (const finding of report.findings) {
      const rule = escapeCell(finding.rule)
      const severity = escapeCell(finding.severity)
      const date = escapeCell(formatDate(finding.where))
      const explanation = escapeCell(finding.explanation)
      lines.push(`| ${rule} | ${severity} | ${date} | ${explanation} |`)
    }
  }
  return lines.join('\n')
}

/** Renders a ComparisonReport as Markdown suitable for PR comments or GITHUB_STEP_SUMMARY. */
export function renderCompareMarkdown(report: ComparisonReport): string {
  const [sourceA, sourceB] = report.sources
  const lines: string[] = []
  lines.push(`## ${escapeHeading(report.symbol)} — ${escapeHeading(sourceA)} vs ${escapeHeading(sourceB)} — consistency_score: ${report.consistency_score}/100`)
  lines.push('')
  if (report.findings.length === 0) {
    lines.push('No findings.')
  } else {
    lines.push('| Rule | Severity | Date | Explanation |')
    lines.push('|---|---|---|---|')
    for (const finding of report.findings) {
      const rule = escapeCell(finding.rule)
      const severity = escapeCell(finding.severity)
      const date = escapeCell(formatDate(finding.where))
      const explanation = escapeCell(finding.explanation)
      lines.push(`| ${rule} | ${severity} | ${date} | ${explanation} |`)
    }
  }
  return lines.join('\n')
}
