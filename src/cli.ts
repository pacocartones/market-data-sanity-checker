#!/usr/bin/env node
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { Command } from 'commander'
import type { ZodIssue } from 'zod'
import { ingestFile } from './ingest/index'
import { marketDataSetSchema, type MarketDataSet } from './schema/market-data'
import { checkMarketData } from './checker'
import { compareDatasets, type ComparisonReport } from './compare/comparator'
import { computeSanityScore, summarize } from './scoring/score'
import { registry } from './rules/registry'
import { compareRegistry } from './compare/registry'
import { connectorStatus, getConnector } from './connectors/index'
import { loadConfig, type MdscConfig } from './config'
import { renderCheckHtml, renderCompareHtml } from './report/html'
import {
  appendHistory,
  readHistory,
  formatHistory,
  historyEntryFromReport,
  DEFAULT_HISTORY_DIR,
} from './history/store'
import type { Finding, SanityReport, Severity } from './report/types'
import { SEVERITY_ORDER } from './report/types'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const MAX_SCHEMA_FINDINGS = 20

/** Maps structural (Zod) issues to findings. Plausibility is the rules engine's job. */
function zodIssuesToFindings(issues: readonly ZodIssue[]): Finding[] {
  const findings = issues.slice(0, MAX_SCHEMA_FINDINGS).map((issue): Finding => {
    const path = issue.path.join('.') || '(root)'
    return {
      rule: 'SCHEMA_INVALID',
      severity: 'critical',
      action: 'block',
      dimension: 'validity',
      where: { path },
      explanation: `Invalid structure at "${path}": ${issue.message}`,
    }
  })
  if (findings.length > 0 && issues.length > MAX_SCHEMA_FINDINGS) {
    findings[0]!.occurrences = issues.length
  }
  return findings
}

function printFindings(findings: readonly Finding[]): void {
  for (const finding of findings) {
    const where = finding.where ? ` [${Object.values(finding.where).join(', ')}]` : ''
    const occurrences = finding.occurrences && finding.occurrences > 1 ? ` ×${finding.occurrences}` : ''
    console.log(
      `  ${finding.severity.toUpperCase().padEnd(8)} ${finding.rule}${occurrences}${where} → ${finding.action}`,
    )
    console.log(`           ${finding.explanation}`)
  }
}

/** Row counts of the parsed dataset, shown when a clean run reports no findings. */
interface DatasetCoverage {
  bars: number
  dividends: number
  splits: number
}

function printTable(report: SanityReport, coverage?: DatasetCoverage): void {
  const { critical, warning, info } = report.summary
  console.log(`\n${report.symbol} (${report.source}) — sanity_score: ${report.sanity_score}/100`)
  console.log(`findings: ${critical} critical · ${warning} warning · ${info} info`)
  printFindings(report.findings)
  if (report.findings.length === 0) {
    console.log(
      coverage
        ? `  No findings. ${coverage.bars} bars · ${coverage.dividends} dividends · ${coverage.splits} splits checked.`
        : '  No findings. This dataset passes all plausibility rules.',
    )
  }
  console.log()
}

function printComparison(report: ComparisonReport): void {
  const { critical, warning, info } = report.summary
  const [sourceA, sourceB] = report.sources
  console.log(
    `\n${report.symbol} — ${sourceA} vs ${sourceB} — consistency_score: ${report.consistency_score}/100`,
  )
  console.log(
    `compared dates: ${report.compared_dates} · only in ${sourceA}: ${report.only_in[sourceA] ?? 0} · only in ${sourceB}: ${report.only_in[sourceB] ?? 0}`,
  )
  console.log(`findings: ${critical} critical · ${warning} warning · ${info} info`)
  printFindings(report.findings)
  if (report.findings.length === 0) {
    console.log(
      `  No findings. Both sources agree within tolerance across ${report.compared_dates} shared dates.`,
    )
  }
  console.log()
}

/** Validates raw input and runs the corpus; structural errors short-circuit to a blocked report. */
function buildReport(raw: unknown, config: MdscConfig['checker'] = {}): SanityReport {
  const parsed = marketDataSetSchema.safeParse(raw)
  if (parsed.success) return checkMarketData(parsed.data, config)
  const envelope = raw as { symbol?: string; source?: string }
  const findings = zodIssuesToFindings(parsed.error.issues)
  return {
    symbol: envelope.symbol ?? 'UNKNOWN',
    source: envelope.source ?? 'unknown',
    sanity_score: computeSanityScore(findings),
    findings,
    summary: summarize(findings),
    generated_at: new Date().toISOString(),
  }
}

interface GatingOptions {
  failOn?: string
  minScore?: string
}

/**
 * CI gating ("alerts"). Exit 1 when: any critical finding (default), or any
 * finding at or above --fail-on severity, or score below --min-score.
 * Returns the exit code and prints the reason to stderr.
 */
function evaluateGating(
  summary: Record<Severity, number>,
  score: number,
  options: GatingOptions,
): number {
  const reasons: string[] = []

  if (options.failOn !== undefined) {
    const threshold = options.failOn as Severity
    if (!(threshold in SEVERITY_ORDER)) {
      console.error(`mdsc: --fail-on must be one of: ${Object.keys(SEVERITY_ORDER).join(', ')}`)
      return 2
    }
    const count = (Object.keys(summary) as Severity[])
      .filter((severity) => SEVERITY_ORDER[severity] <= SEVERITY_ORDER[threshold])
      .reduce((total, severity) => total + summary[severity], 0)
    if (count > 0) reasons.push(`${count} finding(s) at or above --fail-on ${threshold}`)
  } else if (summary.critical > 0) {
    reasons.push(`${summary.critical} critical finding(s)`)
  }

  if (options.minScore !== undefined) {
    const minScore = Number(options.minScore)
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      console.error('mdsc: --min-score must be a number between 0 and 100')
      return 2
    }
    if (score < minScore) reasons.push(`score ${score} below --min-score ${minScore}`)
  }

  for (const reason of reasons) console.error(`mdsc: gate failed — ${reason}`)
  return reasons.length > 0 ? 1 : 0
}

/**
 * Validates --fail-on / --min-score / --format BEFORE anything runs — flag
 * typos must not surface after fetches, ingests or writes already happened.
 * Prints the reason to stderr and returns exit code 2 on the first invalid
 * flag; returns null when every flag is OK.
 */
function validateCommonFlags(options: GatingOptions & { format: string }): number | null {
  if (options.failOn !== undefined && !(options.failOn in SEVERITY_ORDER)) {
    console.error(`mdsc: --fail-on must be one of: ${Object.keys(SEVERITY_ORDER).join(', ')}`)
    return 2
  }
  if (options.minScore !== undefined) {
    const minScore = Number(options.minScore)
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      console.error('mdsc: --min-score must be a number between 0 and 100')
      return 2
    }
  }
  const format = options.format.toLowerCase()
  if (format !== 'table' && format !== 'json') {
    console.error('mdsc: --format must be one of: table, json')
    return 2
  }
  return null
}

/** True for Node's ENOENT ("no such file or directory") errors. */
function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

const program = new Command()

program
  .name('mdsc')
  .description('Trust layer for market data — validate, score and explain anomalies')
  .version(version)

program
  .command('check')
  .description('Check market data against the rule corpus (from a file, or fetched from a provider)')
  .option('--file <path>', 'path to a .csv or .json file')
  .option('--provider <name>', 'fetch from a provider instead (e.g. yahoo, alpha-vantage)')
  .option('--symbol <symbol>', 'symbol to fetch (required with --provider) or override for files')
  .option('--range <range>', 'history range for providers, e.g. 1mo, 1y, 5y', '1y')
  .option('--source <source>', 'data source name for provenance (files only)')
  .option('--format <format>', 'output format: table | json', 'table')
  .option('--config <path>', 'path to a config file (default: ./mdsc.config.json if present)')
  .option('--fail-on <severity>', 'exit 1 on findings at or above: critical | warning | info')
  .option('--min-score <n>', 'exit 1 when the sanity_score is below n (0-100)')
  .option('--save', 'append the result to the audit history (.mdsc/history/)')
  .option('--history-dir <dir>', 'history directory', DEFAULT_HISTORY_DIR)
  .option('--html <path>', 'also write a self-contained HTML dashboard to this path')
  .action(async (options: {
    file?: string
    provider?: string
    symbol?: string
    range: string
    source?: string
    format: string
    config?: string
    failOn?: string
    minScore?: string
    save?: boolean
    historyDir: string
    html?: string
  }) => {
    const invalidFlags = validateCommonFlags(options)
    if (invalidFlags !== null) {
      process.exitCode = invalidFlags
      return
    }
    const format = options.format.toLowerCase()
    try {
      const config = await loadConfig(options.config)

      let raw: unknown
      if (options.provider) {
        if (!options.symbol) {
          console.error('mdsc: --symbol is required when using --provider')
          process.exitCode = 2
          return
        }
        raw = await getConnector(options.provider).fetchDaily(options.symbol, { range: options.range })
      } else if (options.file) {
        try {
          raw = await ingestFile(options.file, { symbol: options.symbol, source: options.source })
        } catch (error) {
          if (isFileNotFound(error)) throw new Error(`cannot read file '${options.file}': file not found`)
          throw error
        }
      } else {
        console.error('mdsc: provide --file <path> or --provider <name> --symbol <symbol>')
        process.exitCode = 2
        return
      }

      const report = buildReport(raw, config.checker)
      const dataset = marketDataSetSchema.safeParse(raw)
      const coverage: DatasetCoverage | undefined = dataset.success
        ? {
            bars: dataset.data.bars.length,
            dividends: dataset.data.dividends?.length ?? 0,
            splits: dataset.data.splits?.length ?? 0,
          }
        : undefined
      if (format === 'json') {
        console.log(JSON.stringify(report, null, 2))
      } else {
        printTable(report, coverage)
      }

      if (options.html) {
        await writeFile(
          options.html,
          renderCheckHtml(report, dataset.success ? { dataset: dataset.data } : {}),
        )
        console.error(`mdsc: HTML dashboard written to ${options.html}`)
      }

      if (options.save) {
        const path = await appendHistory(options.historyDir, historyEntryFromReport(report))
        console.error(`mdsc: saved to audit history (${path})`)
      }

      process.exitCode = evaluateGating(report.summary, report.sanity_score, options)
    } catch (error) {
      console.error(`mdsc: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 2
    }
  })

program
  .command('compare')
  .description('Compare two sources for the same symbol (providers or local files)')
  .option('--symbol <symbol>', 'symbol to fetch from both providers')
  .option('--providers <a,b>', 'two providers, e.g. yahoo,alpha-vantage')
  .option('--files <a,b>', 'two local files (.csv/.json) to compare')
  .option('--range <range>', 'history range for providers, e.g. 1mo, 1y, 5y', '1y')
  .option('--format <format>', 'output format: table | json', 'table')
  .option('--config <path>', 'path to a config file (default: ./mdsc.config.json if present)')
  .option('--fail-on <severity>', 'exit 1 on findings at or above: critical | warning | info')
  .option('--min-score <n>', 'exit 1 when the consistency_score is below n (0-100)')
  .option('--html <path>', 'also write a self-contained HTML dashboard to this path')
  .action(async (options: {
    symbol?: string
    providers?: string
    files?: string
    range: string
    format: string
    config?: string
    failOn?: string
    minScore?: string
    html?: string
  }) => {
    const invalidFlags = validateCommonFlags(options)
    if (invalidFlags !== null) {
      process.exitCode = invalidFlags
      return
    }
    const format = options.format.toLowerCase()
    try {
      const config = await loadConfig(options.config)

      let a: MarketDataSet
      let b: MarketDataSet

      if (options.files) {
        const [fileA, fileB] = options.files.split(',').map((entry) => entry.trim())
        if (!fileA || !fileB) {
          throw new Error(
            '--files needs exactly two paths separated by a comma, e.g. --files "a.csv,b.csv". ' +
              'On PowerShell the quotes are required — an unquoted comma is swallowed by the shell.',
          )
        }
        a = marketDataSetSchema.parse(await ingestFile(fileA, { source: basename(fileA) }))
        b = marketDataSetSchema.parse(await ingestFile(fileB, { source: basename(fileB) }))
      } else {
        if (!options.symbol) throw new Error('--symbol is required when comparing providers')
        const [nameA, nameB] = (options.providers ?? '').split(',').map((entry) => entry.trim())
        if (!nameA || !nameB) {
          throw new Error(
            '--providers needs two providers, e.g. --providers "yahoo,alpha-vantage". ' +
              'On PowerShell the quotes are required — an unquoted comma is swallowed by the shell. ' +
              `Status: ${connectorStatus()
                .map((status) => `${status.name} (${status.available ? 'ready' : `requires ${status.requires}`})`)
                .join(', ')}`,
          )
        }
        a = await getConnector(nameA).fetchDaily(options.symbol, { range: options.range })
        b = await getConnector(nameB).fetchDaily(options.symbol, { range: options.range })
      }

      const report = compareDatasets(a, b, config.compare)
      if (format === 'json') {
        console.log(JSON.stringify(report, null, 2))
      } else {
        printComparison(report)
      }

      if (options.html) {
        await writeFile(options.html, renderCompareHtml(report, { a, b }))
        console.error(`mdsc: HTML dashboard written to ${options.html}`)
      }

      process.exitCode = evaluateGating(report.summary, report.consistency_score, options)
    } catch (error) {
      console.error(`mdsc: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 2
    }
  })

program
  .command('history')
  .description('Show the audit history of a symbol (score evolution over time)')
  .requiredOption('--symbol <symbol>', 'symbol to look up')
  .option('--limit <n>', 'max entries to show', '20')
  .option('--history-dir <dir>', 'history directory', DEFAULT_HISTORY_DIR)
  .action(async (options: { symbol: string; limit: string; historyDir: string }) => {
    try {
      const entries = await readHistory(options.historyDir, options.symbol, Number(options.limit))
      if (entries.length === 0) {
        console.log(`\nNo audit history for ${options.symbol}. Run: mdsc check --provider yahoo --symbol ${options.symbol} --save\n`)
        return
      }
      console.log(`\nAudit history — ${options.symbol}\n`)
      console.log(formatHistory(entries))
      console.log()
    } catch (error) {
      console.error(`mdsc: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 2
    }
  })

program
  .command('rules')
  .description('List the rule catalog with severities, dimensions and references')
  .option('--format <format>', 'output format: table | json', 'table')
  .action((options: { format: string }) => {
    if (options.format === 'json') {
      console.log(
        JSON.stringify(
          {
            single_source: registry.map((rule) => rule.meta),
            compare: compareRegistry.map((rule) => rule.meta),
          },
          null,
          2,
        ),
      )
      return
    }
    console.log(`\n${registry.length} single-source rules\n`)
    for (const rule of registry) {
      const { id, severity, dimension, description, defaultParams, references } = rule.meta
      console.log(`  ${id}  [${severity} · ${dimension}]`)
      console.log(`    ${description}`)
      const params = Object.entries(defaultParams)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      if (params) console.log(`    defaults: ${params}`)
      for (const reference of references) console.log(`    ref: ${reference}`)
    }
    console.log(`\n${compareRegistry.length} compare rules\n`)
    for (const rule of compareRegistry) {
      const { id, severity, dimension, description, defaultParams } = rule.meta
      console.log(`  ${id}  [${severity} · ${dimension}]`)
      console.log(`    ${description}`)
      const params = Object.entries(defaultParams)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      if (params) console.log(`    defaults: ${params}`)
    }
    console.log()
  })

program
  .command('providers')
  .description('List available data providers and their status')
  .action(() => {
    console.log()
    for (const status of connectorStatus()) {
      console.log(`  ${status.name.padEnd(16)} ${status.available ? 'ready' : `unavailable — requires ${status.requires}`}`)
    }
    console.log()
  })

// Bare `mdsc` with no subcommand prints help to stdout and exits 0 — asking
// what the tool does is not an error.
if (process.argv.length > 2) {
  program.parse()
} else {
  program.outputHelp()
}
