/**
 * Audit history store: one JSONL file per symbol (`.mdsc/history/<SYMBOL>.jsonl`).
 *
 * Every `--save` check appends one JSON line, so the sanity_score has memory —
 * you can watch a provider degrade over time instead of trusting a single
 * snapshot. The store is append-only and read-tolerant: a half-written or
 * hand-edited history file must never break the command, corrupt lines are
 * skipped instead.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SanityReport } from '../report/types'

/** One recorded check — a compact, self-contained snapshot of a SanityReport. */
export interface HistoryEntry {
  /** ISO timestamp of the check. */
  at: string
  symbol: string
  source: string
  sanity_score: number
  summary: { critical: number; warning: number; info: number }
  /** Rule ids that fired, deduplicated and sorted. */
  rules: string[]
}

export const DEFAULT_HISTORY_DIR = '.mdsc/history'

/** Default number of entries readHistory returns. */
const DEFAULT_LIMIT = 20

/** Scores within ±TREND_THRESHOLD points of each other count as stable. */
const TREND_THRESHOLD = 3

/** Builds the entry to persist from a finished report. */
export function historyEntryFromReport(report: SanityReport): HistoryEntry {
  return {
    at: report.generated_at,
    symbol: report.symbol,
    source: report.source,
    sanity_score: report.sanity_score,
    summary: {
      critical: report.summary.critical ?? 0,
      warning: report.summary.warning ?? 0,
      info: report.summary.info ?? 0,
    },
    rules: [...new Set(report.findings.map((finding) => finding.rule))].sort(),
  }
}

/**
 * Appends the entry as one JSON line to `<dir>/<SYMBOL>.jsonl`, creating the
 * directory recursively. Returns the path of the history file.
 */
export async function appendHistory(dir: string, entry: HistoryEntry): Promise<string> {
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, historyFileName(entry.symbol))
  await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8')
  return filePath
}

/**
 * Reads the history of a symbol, most recent first. A missing file yields [];
 * corrupt lines (invalid JSON or missing the minimal fields) are skipped.
 */
export async function readHistory(
  dir: string,
  symbol: string,
  limit: number = DEFAULT_LIMIT,
): Promise<HistoryEntry[]> {
  let content: string
  try {
    content = await readFile(join(dir, historyFileName(symbol)), 'utf8')
  } catch {
    return [] // missing file (or unreadable dir): no history yet
  }
  const entries: HistoryEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue // half-written line
    }
    if (isHistoryEntry(parsed)) entries.push(normalizeEntry(parsed))
  }
  // The file is append-only, so file order is chronological — reverse it.
  return entries.reverse().slice(0, Math.max(0, limit))
}

/**
 * Renders entries (most recent first) as a CLI table, plus a trend line
 * comparing the newest score with the oldest one in the set.
 */
export function formatHistory(entries: readonly HistoryEntry[]): string {
  if (entries.length === 0) return 'no history entries'

  const header = ['DATE', 'SCORE', 'C', 'W', 'I', 'RULES']
  const rows = entries.map((entry) => [
    formatDate(entry.at),
    String(entry.sanity_score),
    String(entry.summary.critical),
    String(entry.summary.warning),
    String(entry.summary.info),
    entry.rules.join(','),
  ])

  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  )
  const renderRow = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd()

  const lines = [renderRow(header), ...rows.map(renderRow)]

  const newest = entries[0]!
  const oldest = entries[entries.length - 1]!
  const diff = newest.sanity_score - oldest.sanity_score
  const label = diff > TREND_THRESHOLD ? 'improving' : diff < -TREND_THRESHOLD ? 'degrading' : 'stable'
  lines.push(`trend: ${oldest.sanity_score} → ${newest.sanity_score} (${label})`)

  return lines.join('\n')
}

/**
 * File name for a symbol: uppercase, anything outside [A-Z0-9._-] becomes '_'
 * ('BRK/B' → 'BRK_B.jsonl'). Falls back to 'UNKNOWN' if nothing survives.
 */
function historyFileName(symbol: string): string {
  const sanitized = symbol.toUpperCase().replace(/[^A-Z0-9._-]/g, '_')
  return `${sanitized === '' ? 'UNKNOWN' : sanitized}.jsonl`
}

/** Minimal shape check — a line without the core fields counts as corrupt. */
function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.at === 'string' &&
    typeof entry.symbol === 'string' &&
    typeof entry.sanity_score === 'number' &&
    Number.isFinite(entry.sanity_score)
  )
}

/** Fills defaults for fields a hand-edited line might be missing. */
function normalizeEntry(entry: HistoryEntry): HistoryEntry {
  const summary = entry.summary ?? { critical: 0, warning: 0, info: 0 }
  return {
    ...entry,
    summary: {
      critical: summary.critical ?? 0,
      warning: summary.warning ?? 0,
      info: summary.info ?? 0,
    },
    rules: Array.isArray(entry.rules) ? entry.rules.filter((rule) => typeof rule === 'string') : [],
  }
}

/** '2026-01-15T09:30:00.000Z' → '2026-01-15 09:30'; odd values pass through trimmed. */
function formatDate(at: string): string {
  return at.replace('T', ' ').slice(0, 16)
}
