import type { Finding, SanityReport } from './types'
import type { ComparisonReport } from '../compare/comparator'

const ZERO_WIDTH_SPACE = '\u200b'

function foldLines(value: string): string {
  return value.replaceAll(/[\r\n]+/g, ' ')
}

/**
 * GitHub applies autolinks and other extensions after processing CommonMark
 * backslash escapes. Separators keep linkable tokens and emoji shortcodes as
 * visible text; paired dollar delimiters use a full-width opener because even
 * escaped ASCII dollars start GitHub's math extension.
 */
function neutralizeGithubExtensions(value: string): string {
  return value
    .replaceAll(/\bhttps?(?=:\/\/)/gi, (scheme) => `${scheme}${ZERO_WIDTH_SPACE}`)
    .replaceAll(/\bwww(?=\.)/gi, (www) => `${www}${ZERO_WIDTH_SPACE}`)
    .replaceAll(/@(?=[a-z0-9-]+(?:\.[a-z0-9-]+)+\b)/gi, `@${ZERO_WIDTH_SPACE}`)
    .replaceAll(/@(?=[a-z0-9](?:[a-z0-9-]{0,38})\b)/gi, `@${ZERO_WIDTH_SPACE}`)
    .replaceAll(/#(?=\d+\b)/g, `#${ZERO_WIDTH_SPACE}`)
    .replaceAll(/\bGH-(?=\d+\b)/gi, (prefix) => `${prefix}${ZERO_WIDTH_SPACE}`)
    .replaceAll(/\$(?=[^$]*\$)/g, '＄')
    .replaceAll(/:(?=[a-z0-9_+-]{2,}:)/gi, `:${ZERO_WIDTH_SPACE}`)
    .replaceAll(/\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, (sha) =>
      `${sha[0]}${ZERO_WIDTH_SPACE}${sha.slice(1)}`,
    )
}

export function escapeCell(value: string): string {
  const escaped = foldLines(value)
    .replaceAll(/[\\[\]<>`*~&|]/g, '\\$&')
    // Intraword underscores are literal in CommonMark and stable rule IDs rely on them.
    .replaceAll(/(?<![a-z0-9])_|_(?![a-z0-9])/gi, '\\_')
  return neutralizeGithubExtensions(escaped)
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
  ['~', '\\~'],
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
  let out = foldLines(value)
  for (const [from, to] of HEADING_ESCAPES) out = out.replaceAll(from, to)
  return neutralizeGithubExtensions(out)
}

function formatDate(where: Finding['where']): string {
  if (!where || where.date === undefined || where.date === null) return '-'
  return String(where.date)
}

/** Renders a single-source SanityReport as Markdown suitable for PR comments or GITHUB_STEP_SUMMARY. */
export function renderReportMarkdown(report: SanityReport): string {
  const lines: string[] = []
  const score = escapeHeading(String(report.sanity_score))
  lines.push(`## ${escapeHeading(report.symbol)} (${escapeHeading(report.source)}) — sanity_score: ${score}/100`)
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
  const score = escapeHeading(String(report.consistency_score))
  lines.push(`## ${escapeHeading(report.symbol)} — ${escapeHeading(sourceA)} vs ${escapeHeading(sourceB)} — consistency_score: ${score}/100`)
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
