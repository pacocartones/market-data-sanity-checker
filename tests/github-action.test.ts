import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Tests for the GitHub Action wrapper (action.yml → action/run.sh). The script
 * runs under bash with jq, as on GitHub-hosted runners; MDSC_CLI points it at the
 * compiled CLI instead of npx, so nothing is downloaded. Skipped on Windows; the
 * self-test workflow runs the action itself on a runner.
 */

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(REPO_ROOT, 'dist', 'cli.js')
const RUN = join(REPO_ROOT, 'action', 'run.sh')
const fixture = (name: string) => join(REPO_ROOT, 'tests', 'fixtures', name)

const TIMEOUT_MS = 30_000

interface ActionResult {
  code: number
  stdout: string
  stderr: string
  outputs: Record<string, string>
  summary: string
}

let dir = ''

/** Runs action/run.sh with MDSC_* inputs; non-zero exits resolve with their code. */
async function runAction(env: Record<string, string>): Promise<ActionResult> {
  const outputPath = join(dir, 'output.txt')
  const summaryPath = join(dir, 'summary.md')
  const fullEnv = {
    PATH: process.env.PATH ?? '',
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    MDSC_CLI: `${process.execPath} ${CLI}`,
    ...env,
  }
  let code = 0
  let stdout: string
  let stderr: string
  try {
    ;({ stdout, stderr } = await execFileAsync('bash', [RUN], { cwd: REPO_ROOT, env: fullEnv }))
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown }
    if (typeof failed.code !== 'number') throw error // spawn failure, not an exit code
    code = failed.code
    stdout = typeof failed.stdout === 'string' ? failed.stdout : ''
    stderr = typeof failed.stderr === 'string' ? failed.stderr : ''
  }
  const read = (path: string) => readFile(path, 'utf8').catch(() => '')
  const outputs = Object.fromEntries(
    (await read(outputPath))
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  return { code, stdout, stderr, outputs, summary: await read(summaryPath) }
}

beforeAll(async () => {
  try {
    await access(CLI)
  } catch {
    await execFileAsync('pnpm build', { cwd: REPO_ROOT, timeout: 120_000, shell: true })
  }
}, 180_000)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-action-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('GitHub Action wrapper', () => {
  it(
    'passes on clean data and writes the outputs and the summary',
    async () => {
      const result = await runAction({ MDSC_FILE: fixture('ohlcv-valid.csv'), MDSC_FAIL_ON: 'critical' })
      expect(result.code).toBe(0)
      expect(result.outputs.score).toBe('80')
      expect(result.outputs.critical).toBe('0')
      expect(result.outputs.report).toBe(join(dir, 'mdsc-report.json'))
      expect(result.summary).toContain('market-data-sanity-checker: passed')
      expect(result.summary).toContain('| 80 | 0 |')
    },
    TIMEOUT_MS,
  )

  it(
    'fails the step on a critical finding and still reports',
    async () => {
      const result = await runAction({ MDSC_FILE: fixture('berkshire-bad-tick.json'), MDSC_FAIL_ON: 'critical' })
      expect(result.code).toBe(1)
      expect(result.outputs.critical).toBe('1')
      expect(result.summary).toContain('market-data-sanity-checker: failed')
      const report = JSON.parse(await readFile(join(dir, 'mdsc-report.json'), 'utf8'))
      expect(report.symbol).toBe('BRK.A')
    },
    TIMEOUT_MS,
  )

  it(
    'encodes CLI diagnostics before replaying them to the runner log',
    async () => {
      const csv = join(dir, 'workflow-command.csv')
      await writeFile(
        csv,
        '"date\n::add-mask::forged",open,high,low,close\n2024-01-02,100,101,99,100.5\n',
        'utf8',
      )

      const result = await runAction({ MDSC_FILE: csv })
      const combinedLog = `${result.stdout}\n${result.stderr}`

      expect(result.code).toBe(2)
      expect(result.stderr).toContain(String.raw`\n::add-mask::forged`)
      expect(result.stderr.trim().split('\n')).toHaveLength(1)
      expect(combinedLog).not.toMatch(/(?:^|\r?\n)::add-mask::forged/)
      expect(result.stdout).toContain('::error title=market-data-sanity-checker::mdsc produced no report')
    },
    TIMEOUT_MS,
  )

  it(
    'gates on warnings with fail-on warning, and on min-score',
    async () => {
      const clean = fixture('ohlcv-valid.csv')
      expect((await runAction({ MDSC_FILE: clean, MDSC_FAIL_ON: 'warning' })).code).toBe(1)
      expect((await runAction({ MDSC_FILE: clean, MDSC_MIN_SCORE: '80' })).code).toBe(0)
      expect((await runAction({ MDSC_FILE: clean, MDSC_MIN_SCORE: '81' })).code).toBe(1)
    },
    TIMEOUT_MS,
  )

  it(
    'defaults to the exact package version of this ref, and accepts an explicit one',
    async () => {
      const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
      const clean = fixture('ohlcv-valid.csv')
      expect((await runAction({ MDSC_FILE: clean })).stdout).toContain(`market-data-sanity-checker@${pkg.version}\n`)
      expect((await runAction({ MDSC_FILE: clean, MDSC_VERSION: '1' })).stdout).toContain('market-data-sanity-checker@1\n')
    },
    TIMEOUT_MS,
  )

  it.each([
    [{ MDSC_FILE: '' }, "'file' input is required"],
    [{ MDSC_FILE: 'missing.csv' }, 'file not found'],
    [{ MDSC_VERSION: '1 --registry=http://evil' }, "'version' must be"],
    [{ MDSC_VERSION: 'latest' }, "'version' must be"],
    [{ MDSC_FAIL_ON: 'error' }, "'fail-on' must be"],
    [{ MDSC_MIN_SCORE: '101' }, "'min-score' must be"],
    [{ MDSC_MIN_SCORE: '80; ls' }, "'min-score' must be"],
  ])(
    'rejects invalid input %o with exit 2 before running mdsc',
    async (env, message) => {
      const result = await runAction({ MDSC_FILE: fixture('ohlcv-valid.csv'), ...env })
      expect(result.code).toBe(2)
      expect(result.stdout).toContain(message)
      expect(result.outputs).toEqual({})
    },
    TIMEOUT_MS,
  )

  it(
    'encodes rejected action inputs before emitting an error annotation',
    async () => {
      const result = await runAction({
        MDSC_FILE: fixture('ohlcv-valid.csv'),
        MDSC_VERSION: 'latest\n::warning::forged',
      })

      expect(result.code).toBe(2)
      expect(result.stdout).toContain(String.raw`\n::warning::forged`)
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(result.stdout).not.toMatch(/(?:^|\r?\n)::warning::forged/)
    },
    TIMEOUT_MS,
  )
})
