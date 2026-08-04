/**
 * Scoreboard: the public, reproducible audit of market data providers.
 *
 * For each available provider it fetches a basket of liquid symbols, runs the
 * corpus, and aggregates sanity scores. When two or more providers are
 * available it also runs the comparison engine between them. Results are
 * written to scoreboard/latest.json and scoreboard/README.md, plus the
 * machine-readable scoreboard/latest.csv with its Frictionless descriptor
 * scoreboard/datapackage.json — regenerated weekly by the scoreboard GitHub
 * Action, or locally with:
 *
 *   pnpm scoreboard
 *
 * Quorum guard: if a provider fails more than 20% of the basket fetches, the
 * run is unrepresentative (outage, throttling, breaking API change), so the
 * script aborts with exit code 1 BEFORE writing any file — a degraded run is
 * never published over the previous good one.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { connectors, connectorStatus } from '../src/connectors/index'
import { checkMarketData } from '../src/checker'
import { compareDatasets } from '../src/compare/comparator'
import type { MarketDataSet } from '../src/schema/market-data'

const BASKET = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'JPM', 'V',
  'KO', 'PG', 'JNJ', 'XOM', 'WMT', 'BRK-B', 'GE', 'CAT', 'BA', 'HON',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'GLD', 'TLT', 'EEM', 'ARKK', 'NFLX',
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** RFC 4180-style quoting: only fields containing a quote, comma or line break need it. */
const escapeCsvField = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

interface ProviderResult {
  provider: string
  symbols_ok: number
  symbols_failed: number
  mean_score: number
  min_score: number
  worst_symbols: Array<{ symbol: string; score: number; rules: string[] }>
  total_findings: Record<string, number>
}

/** One row of scoreboard/latest.csv: a (provider, symbol) pair. score/summary are null when the fetch failed. */
interface SymbolRow {
  provider: string
  symbol: string
  score: number | null
  summary: { critical: number; warning: number; info: number } | null
  rules: string
}

const active = Object.values(connectors).filter((connector) => connector.available())
console.log(`providers available: ${active.map((connector) => connector.name).join(', ') || 'none'}`)
console.log(
  `providers unavailable: ${connectorStatus()
    .filter((status) => !status.available)
    .map((status) => `${status.name} (requires ${status.requires})`)
    .join(', ') || 'none'}`,
)
if (active.length === 0) {
  console.error('no provider available — nothing to do')
  process.exit(1)
}

const datasetsByProvider = new Map<string, Map<string, MarketDataSet>>()
const providerResults: ProviderResult[] = []
const symbolRows: SymbolRow[] = []

for (const connector of active) {
  const datasets = new Map<string, MarketDataSet>()
  datasetsByProvider.set(connector.name, datasets)
  const scores: Array<{
    symbol: string
    score: number
    rules: string[]
    summary: { critical: number; warning: number; info: number }
  }> = []
  const failedSymbols: string[] = []
  const findingsCount: Record<string, number> = { critical: 0, warning: 0, info: 0 }
  let failed = 0

  for (const symbol of BASKET) {
    try {
      const data = await connector.fetchDaily(symbol, { range: '1y' })
      datasets.set(symbol, data)
      const report = checkMarketData(data)
      scores.push({
        symbol,
        score: report.sanity_score,
        rules: report.findings.map((finding) => finding.rule),
        summary: {
          critical: report.summary.critical,
          warning: report.summary.warning,
          info: report.summary.info,
        },
      })
      findingsCount.critical! += report.summary.critical
      findingsCount.warning! += report.summary.warning
      findingsCount.info! += report.summary.info
    } catch (error) {
      failed += 1
      failedSymbols.push(symbol)
      console.log(`${connector.name}/${symbol}: FETCH FAILED (${error instanceof Error ? error.message : String(error)})`)
    }
    await sleep(300)
  }

  // Quorum guard: abort the whole run without writing anything rather than
  // publish a scoreboard built from a provider that failed >20% of the basket.
  if (failed / BASKET.length > 0.2) {
    console.error(
      `scoreboard aborted: ${failed}/${BASKET.length} fetches failed (>20% quorum) — refusing to publish a degraded run`,
    )
    process.exit(1)
  }

  // CSV rows are collected in basket order, before the in-place sort below.
  for (const entry of scores) {
    symbolRows.push({
      provider: connector.name,
      symbol: entry.symbol,
      score: entry.score,
      summary: entry.summary,
      rules: entry.rules.join(';'),
    })
  }
  for (const symbol of failedSymbols) {
    symbolRows.push({ provider: connector.name, symbol, score: null, summary: null, rules: 'FETCH_FAILED' })
  }

  const mean = scores.length > 0 ? scores.reduce((sum, entry) => sum + entry.score, 0) / scores.length : 0
  providerResults.push({
    provider: connector.name,
    symbols_ok: scores.length,
    symbols_failed: failed,
    mean_score: Number(mean.toFixed(1)),
    min_score: scores.length > 0 ? Math.min(...scores.map((entry) => entry.score)) : 0,
    // Strip summary: latest.json keeps its original shape.
    worst_symbols: scores
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(({ symbol, score, rules }) => ({ symbol, score, rules })),
    total_findings: findingsCount,
  })
  console.log(`${connector.name}: mean ${mean.toFixed(1)}/100 over ${scores.length} symbols`)
}

const comparisons: unknown[] = []
if (active.length >= 2) {
  const [first, second] = active
  for (const symbol of BASKET) {
    const a = datasetsByProvider.get(first!.name)?.get(symbol)
    const b = datasetsByProvider.get(second!.name)?.get(symbol)
    if (!a || !b) continue
    const report = compareDatasets(a, b)
    comparisons.push({
      symbol,
      consistency_score: report.consistency_score,
      compared_dates: report.compared_dates,
      findings: report.findings.map(({ rule, severity, where }) => ({ rule, severity, where })),
    })
    console.log(`compare ${symbol}: ${report.consistency_score}/100 (${report.findings.length} findings)`)
  }
}

const generatedAt = new Date().toISOString()
await mkdir('scoreboard', { recursive: true })
await writeFile(
  'scoreboard/latest.json',
  JSON.stringify({ generated_at: generatedAt, basket: BASKET, range: '1y', providers: providerResults, comparisons }, null, 2),
)

const lines = [
  '# Provider scoreboard',
  '',
  `Generated: ${generatedAt} · basket: ${BASKET.length} liquid symbols · range: 1y · reproducible with \`pnpm scoreboard\``,
  '',
  '| Provider | Symbols | Mean sanity score | Min | Critical | Warning | Info |',
  '|---|---|---|---|---|---|---|',
  ...providerResults.map(
    (result) =>
      `| ${result.provider} | ${result.symbols_ok} (+${result.symbols_failed} failed) | ${result.mean_score} | ${result.min_score} | ${result.total_findings.critical} | ${result.total_findings.warning} | ${result.total_findings.info} |`,
  ),
  '',
  '## Worst-scoring symbols per provider',
  '',
  ...providerResults.flatMap((result) => [
    `### ${result.provider}`,
    '',
    ...result.worst_symbols.map(
      (entry) => `- **${entry.symbol}** — ${entry.score}/100${entry.rules.length > 0 ? ` (${entry.rules.join(', ')})` : ' (clean)'}`,
    ),
    '',
  ]),
  comparisons.length > 0 ? `## Cross-provider consistency\n\n\`\`\`json\n${JSON.stringify(comparisons, null, 2)}\n\`\`\`\n` : '',
]
await writeFile('scoreboard/README.md', lines.join('\n'))

const csvLines = [
  'generated_at,provider,symbol,sanity_score,critical,warning,info,rules',
  ...symbolRows.map((row) =>
    [
      generatedAt,
      row.provider,
      row.symbol,
      row.score === null ? '' : String(row.score),
      row.summary === null ? '' : String(row.summary.critical),
      row.summary === null ? '' : String(row.summary.warning),
      row.summary === null ? '' : String(row.summary.info),
      row.rules,
    ]
      .map(escapeCsvField)
      .join(','),
  ),
]
await writeFile('scoreboard/latest.csv', `${csvLines.join('\n')}\n`)

// Frictionless Data Package descriptor, generated here so it cannot drift from the CSV.
const datapackage = {
  profile: 'tabular-data-package',
  name: 'market-data-provider-scoreboard',
  title: 'Market Data Provider Scoreboard',
  description: 'weekly audit of market data providers with mdsc sanity scores',
  homepage: 'https://github.com/pacocartones/market-data-sanity-checker',
  created: generatedAt,
  resources: [
    {
      name: 'scoreboard',
      path: 'latest.csv',
      profile: 'tabular-data-resource',
      schema: {
        fields: [
          { name: 'generated_at', type: 'datetime' },
          { name: 'provider', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'sanity_score', type: 'integer' },
          { name: 'critical', type: 'integer' },
          { name: 'warning', type: 'integer' },
          { name: 'info', type: 'integer' },
          { name: 'rules', type: 'string' },
        ],
      },
    },
  ],
}
await writeFile('scoreboard/datapackage.json', `${JSON.stringify(datapackage, null, 2)}\n`)

console.log('\nwritten: scoreboard/latest.json + scoreboard/README.md + scoreboard/latest.csv + scoreboard/datapackage.json')
