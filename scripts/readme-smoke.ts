#!/usr/bin/env node
// readme-smoke.ts — run the README's commands against the packed npm package.
//
// The README is the first thing a user copies. This packs the package exactly as
// npm would publish it, installs the tarball in an empty directory, and runs
// every `mdsc …` / `npx market-data-sanity-checker …` line of the README's shell
// blocks there. Placeholder file names are mapped to repository fixtures.
// Commands that need the network (--provider) are skipped unless SMOKE_NETWORK=1.
//
// Exit code 1 is the documented gating result (--fail-on / --min-score) and
// passes; 2 or more, or an unknown-option error, fails.
//
// Usage: pnpm build && pnpm smoke:readme
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FIXTURES = join(ROOT, 'tests', 'fixtures')

/** README placeholder → fixture copied into the work directory under that name. */
const PLACEHOLDERS: Record<string, string> = {
  'your-data.csv': 'ohlcv-valid.csv',
  'aapl.csv': 'ohlcv-valid.csv',
  'aapl.json': 'bars-array.json',
  'yahoo-aapl.json': 'bars-array.json',
  'stooq-aapl.csv': 'ohlcv-valid.csv',
}

export function readmeCommands(markdown: string): string[] {
  const commands: string[] = []
  let inShell = false
  for (const line of markdown.split('\n')) {
    if (/^```(bash|sh|shell)\s*$/.test(line)) {
      inShell = true
      continue
    }
    if (line.startsWith('```')) {
      inShell = false
      continue
    }
    if (!inShell) continue
    const command = line.replace(/\s+#.*$/, '').trim()
    if (/^(mdsc|npx market-data-sanity-checker)\s/.test(command)) commands.push(command)
  }
  return commands
}

function main(): void {
  const commands = readmeCommands(readFileSync(join(ROOT, 'README.md'), 'utf8'))
  if (commands.length === 0) throw new Error('no mdsc commands found in README.md')

  const work = mkdtempSync(join(tmpdir(), 'mdsc-readme-'))
  try {
    const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .split('\n')
      .pop()!
    execFileSync('npm', ['init', '-y'], { cwd: work, stdio: 'ignore' })
    execFileSync('npm', ['install', '--no-audit', '--no-fund', join(work, packed)], { cwd: work, stdio: 'ignore' })
    for (const [name, fixture] of Object.entries(PLACEHOLDERS)) copyFileSync(join(FIXTURES, fixture), join(work, name))

    const bin = join(work, 'node_modules', '.bin', 'mdsc')
    const failures: string[] = []
    let ran = 0
    for (const command of commands) {
      if (/--provider(s)?\s/.test(command) && process.env.SMOKE_NETWORK !== '1') {
        console.log(`skip (network)  ${command}`)
        continue
      }
      const shell = command.replace(/^(npx market-data-sanity-checker|mdsc)\s/, `"${bin}" `)
      const result = spawnSync('bash', ['-c', shell], { cwd: work, encoding: 'utf8' })
      ran += 1
      const output = `${result.stdout}${result.stderr}`
      const unknown = /unknown (option|command)|too many arguments/i.test(output)
      const ok = (result.status === 0 || result.status === 1) && !unknown
      console.log(`${ok ? 'ok  ' : 'FAIL'} exit ${result.status}  ${command}`)
      if (!ok) failures.push(`${command}\n  exit ${result.status}\n  ${output.trim().split('\n').slice(-3).join('\n  ')}`)
    }
    console.log(`\n${ran} README command(s) ran against ${packed}, ${commands.length - ran} skipped`)
    if (failures.length > 0) {
      console.error(`\n${failures.length} README command(s) failed:\n\n${failures.join('\n\n')}`)
      process.exitCode = 1
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
