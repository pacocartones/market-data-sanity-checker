/**
 * Calibration runner: audits ~50 liquid symbols from Yahoo against the full
 * corpus and dumps every finding for manual review.
 *
 * This is the project's honesty loop: synthetic guardians prove the corpus is
 * quiet on plausible data; this script proves it on REAL data. Run it before
 * every release:
 *
 *   pnpm calibrate
 *
 * Output: console summary + calibration/latest.json (committed as evidence).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { yahoo } from '../src/connectors/yahoo'
import { checkMarketData } from '../src/checker'
import type { Finding } from '../src/report/types'

const SYMBOLS = [
  // mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'AMD', 'NFLX',
  // dividend payers
  'KO', 'PG', 'JNJ', 'PEP', 'MCD', 'WMT', 'VZ', 'T', 'XOM', 'CVX',
  // financials
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA', 'AXP', 'BRK-B', 'SCHW',
  // industrials & others
  'GE', 'CAT', 'BA', 'HON', 'UPS', 'DE', 'LMT', 'RTX', 'UNP', 'FDX',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'ARKK', 'GLD', 'TLT', 'EEM',
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface SymbolResult {
  symbol: string
  sanity_score: number
  bars: number
  findings: Array<Pick<Finding, 'rule' | 'severity' | 'where' | 'explanation' | 'occurrences'>>
  error?: string
}

const results: SymbolResult[] = []
let failures = 0

for (const symbol of SYMBOLS) {
  try {
    const data = await yahoo.fetchDaily(symbol, { range: '1y' })
    const report = checkMarketData(data)
    results.push({
      symbol,
      sanity_score: report.sanity_score,
      bars: data.bars.length,
      findings: report.findings.map(({ rule, severity, where, explanation, occurrences }) => ({
        rule,
        severity,
        where,
        explanation,
        occurrences,
      })),
    })
    const marker = report.summary.critical > 0 ? 'CRITICAL' : report.summary.warning > 0 ? 'warning' : 'clean'
    console.log(`${symbol.padEnd(8)} ${String(report.sanity_score).padStart(3)}/100  ${marker}  (${report.findings.length} findings)`)
  } catch (error) {
    failures += 1
    results.push({
      symbol,
      sanity_score: -1,
      bars: 0,
      findings: [],
      error: error instanceof Error ? error.message : String(error),
    })
    console.log(`${symbol.padEnd(8)} FETCH FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
  await sleep(300) // be gentle with the free endpoint
}

const withFindings = results.filter((result) => result.findings.length > 0)
const ruleCounts = new Map<string, number>()
for (const result of withFindings) {
  for (const finding of result.findings) {
    ruleCounts.set(finding.rule, (ruleCounts.get(finding.rule) ?? 0) + 1)
  }
}

console.log('\n=== CALIBRATION SUMMARY ===')
console.log(`symbols audited: ${results.length - failures}/${SYMBOLS.length} (${failures} fetch failures)`)
console.log(`clean: ${results.filter((r) => r.findings.length === 0).length} · with findings: ${withFindings.length}`)
console.log(`critical findings: ${withFindings.reduce((n, r) => n + r.findings.filter((f) => f.severity === 'critical').length, 0)}`)
console.log('\nrules that fired:')
for (const [rule, count] of [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule}: ${count} symbol(s)`)
}
if (withFindings.length > 0) {
  console.log('\n=== FINDINGS FOR MANUAL REVIEW ===')
  for (const result of withFindings) {
    for (const finding of result.findings) {
      console.log(`\n${result.symbol} — ${finding.rule} [${finding.severity}]${finding.where ? ` [${Object.values(finding.where).join(', ')}]` : ''}`)
      console.log(`  ${finding.explanation}`)
    }
  }
}

await mkdir('calibration', { recursive: true })
await writeFile(
  'calibration/latest.json',
  JSON.stringify({ generated_at: new Date().toISOString(), range: '1y', provider: 'yahoo', results }, null, 2),
)
console.log('\nwritten: calibration/latest.json')
