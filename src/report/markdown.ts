import type { Finding, SanityReport } from './types'
import type { ComparisonReport } from '../compare/comparator'

// CommonMark permits a backslash before any ASCII punctuation character. Escaping
// the complete set keeps untrusted values as literal text instead of trying to
// maintain separate, incomplete lists for links, HTML, entities and extensions.
const MARKDOWN_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll(/[\r\n]+/g, ' ')
    .replaceAll(MARKDOWN_PUNCTUATION, '\\$&')
}

export function escapeCell(value: string): string {
  return escapeMarkdownText(value)
}

/**
 * Escapes a value interpolated into the `##` heading line. Headings and cells
 * deliberately share the same plain-text invariant so neither context can emit
 * attacker-controlled Markdown or HTML.
 */
export function escapeHeading(value: string): string {
  return escapeMarkdownText(value)
}

function formatDate(where: Finding['where']): string {
  if (!where || where.date === undefined || where.date === null) return '-'
  return String(where.date)
}

/**
 * Renders a single-source SanityReport as Markdown suitable for PR comments or
 * GITHUB_STEP_SUMMARY. Untrusted values are encoded as literal text for consumers
 * that implement CommonMark backslash escapes.
 */
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

/**
 * Renders a ComparisonReport as Markdown suitable for PR comments or
 * GITHUB_STEP_SUMMARY. Untrusted values are encoded as literal text for consumers
 * that implement CommonMark backslash escapes.
 */
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
