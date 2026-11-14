export interface ScoreboardProviderResult {
  provider: string
  symbols_ok: number
  symbols_failed: number
  symbols_skipped: number
  mean_score: number
  min_score: number
  worst_symbols: Array<{ symbol: string; score: number; rules: string[] }>
  total_findings: Record<string, number>
}

export interface SkippedProvider {
  provider: string
  symbols: string[]
}

interface ExcludedProvider {
  provider: string
  failed: number
}

export interface ScoreboardFinding {
  rule: string
  severity: string
  where?: Record<string, string | number>
}

export interface ScoreboardComparison {
  symbol: string
  consistency_score: number
  compared_dates: number
  findings: ScoreboardFinding[]
}

interface ScoreboardReadmeInput {
  generatedAt: string
  basketSize: number
  providers: ScoreboardProviderResult[]
  excluded: ExcludedProvider[]
  skipped: SkippedProvider[]
  comparisons: ScoreboardComparison[]
  /** Paragraphs shown under the cross-provider heading, before the table (for example, a plan limit). */
  comparisonNotes?: string[]
}

/**
 * Shown next to the cross-provider table when Alpha Vantage runs on its free plan. That plan
 * returns the latest 100 daily bars, unadjusted, with no dividends or splits, so a corporate
 * action the other source reports cannot be matched there. The note keeps the table from reading
 * as a data defect of either feed.
 */
export const ALPHA_VANTAGE_FREE_PLAN_NOTE =
  'Alpha Vantage runs here on its free plan, which returns the latest 100 daily bars, unadjusted, ' +
  'without dividends or splits. A `DIVIDEND_MISMATCH` or `SPLIT_MISMATCH` against Alpha Vantage in ' +
  'this table therefore means that the event is outside what that plan returns, not that either feed ' +
  'has wrong data. Corporate actions can only be compared between sources whose plans both include them.'

function formatFindings(findings: ScoreboardFinding[]): string {
  if (findings.length === 0) return 'none'
  return findings
    .map((f) => (f.where?.date !== undefined ? `${f.rule} (${f.severity}, ${f.where.date})` : `${f.rule} (${f.severity})`))
    .join('; ')
}

/** Render the checked-in weekly scoreboard README without touching provider data. */
export function renderScoreboardReadme({
  generatedAt,
  basketSize,
  providers,
  excluded,
  skipped,
  comparisons,
  comparisonNotes = [],
}: ScoreboardReadmeInput): string {
  const lines = [
    '# Provider scoreboard',
    '',
    `Generated: ${generatedAt} · basket: ${basketSize} liquid symbols · range: 1y · reproducible with \`pnpm scoreboard\``,
    '',
    '| Provider | Symbols | Mean sanity score | Min | Critical | Warning | Info |',
    '|---|---|---|---|---|---|---|',
    ...providers.map(
      (result) =>
        `| ${result.provider} | ${result.symbols_ok} (+${result.symbols_failed} failed${result.symbols_skipped > 0 ? `, ${result.symbols_skipped} skipped: daily cap` : ''}) | ${result.mean_score} | ${result.min_score} | ${result.total_findings.critical} | ${result.total_findings.warning} | ${result.total_findings.info} |`,
    ),
    ...(skipped.length > 0
      ? ['', ...skipped.map((entry) => `- ${entry.provider} skipped (daily request cap): ${entry.symbols.join(', ')}`)]
      : []),
    ...(excluded.length > 0
      ? [
          '',
          `Excluded this run (more than 20% of fetches failed, so none of their numbers are published): ${excluded
            .map((entry) => `${entry.provider} (${entry.failed}/${basketSize} failed)`)
            .join(', ')}`,
        ]
      : []),
    '',
    '## Worst-scoring symbols per provider',
    '',
    ...providers.flatMap((result) => [
      `### ${result.provider}`,
      '',
      ...result.worst_symbols.map(
        (entry) => `- **${entry.symbol}** — ${entry.score}/100${entry.rules.length > 0 ? ` (${entry.rules.join(', ')})` : ' (clean)'}`,
      ),
      '',
    ]),
    ...(comparisons.length > 0
      ? [
          '## Cross-provider consistency',
          '',
          ...comparisonNotes.flatMap((note) => [note, '']),
          '| Symbol | Consistency score | Compared dates | Findings |',
          '|---|---|---|---|',
          ...comparisons.map(
            (c) =>
              `| ${c.symbol} | ${c.consistency_score} | ${c.compared_dates} | ${formatFindings(c.findings)} |`,
          ),
          '',
        ]
      : []),
  ]
  return lines.join('\n')
}
