/**
 * Coverage badge: reads the vitest coverage summary (the `json-summary` reporter) and writes a
 * Shields "endpoint" JSON, so the README badge needs no coverage service and no secret.
 *
 *   tsx scripts/coverage-badge.ts [<coverage-summary.json> [<badge.json>]]
 *   (defaults: coverage/coverage-summary.json -> coverage/coverage-badge.json)
 *
 * The number is LINE coverage of the whole project (`total.lines.pct`), shown rounded DOWN to a
 * whole percent so the badge never claims more than was measured. The label says so.
 * Colour: below 60 red, below 80 yellow, 80 and above green.
 *
 * Exit codes: 0 written, 1 the summary is missing or unusable (nothing is written, so a stale or
 * invented badge can never be published), 2 wrong usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LABEL = 'coverage (lines)'
export const RED_BELOW = 60
export const YELLOW_BELOW = 80

export interface Badge {
  schemaVersion: 1
  label: string
  message: string
  color: 'red' | 'yellow' | 'green'
}

export function colorFor(pct: number): Badge['color'] {
  if (pct < RED_BELOW) return 'red'
  if (pct < YELLOW_BELOW) return 'yellow'
  return 'green'
}

/** The project-wide line percentage of a vitest/istanbul `json-summary`, or an Error saying what is wrong. */
export function linesPercent(summary: unknown): number {
  const pct = (summary as { total?: { lines?: { pct?: unknown } } } | null)?.total?.lines?.pct
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`total.lines.pct is not a number between 0 and 100 (got ${JSON.stringify(pct)})`)
  }
  return pct
}

/** Whole percent, rounded down; colour from the unrounded value (the thresholds are whole numbers, so both agree). */
export function buildBadge(summary: unknown): Badge {
  const pct = linesPercent(summary)
  return { schemaVersion: 1, label: LABEL, message: `${Math.floor(pct)}%`, color: colorFor(pct) }
}

export function run(argv: string[], err: (line: string) => void = (line) => console.error(line)): number {
  if (argv.length > 2) {
    err('usage: coverage-badge.ts [<coverage-summary.json> [<badge.json>]]')
    return 2
  }
  const [input = 'coverage/coverage-summary.json', output = 'coverage/coverage-badge.json'] = argv
  let badge: Badge
  try {
    badge = buildBadge(JSON.parse(readFileSync(input, 'utf8')))
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    err(`coverage-badge: cannot build the badge from ${input}: ${reason}`)
    err('coverage-badge: run `pnpm test:coverage` first (the vitest config must emit the json-summary reporter).')
    return 1
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(badge)}\n`)
  console.log(`coverage-badge: ${badge.label} ${badge.message} (${badge.color}) -> ${output}`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = run(process.argv.slice(2))
}
