import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Platform tests for the compiled CLI: exit codes (CI gating), early flag
 * validation and config overrides. These run `node dist/cli.js` as a real
 * subprocess; the beforeAll builds dist/ when missing (clean checkout, CI).
 * Each invocation takes ~1s; timeouts are generous.
 */

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(REPO_ROOT, 'dist', 'cli.js')
const fixture = (name: string) => join(REPO_ROOT, 'tests', 'fixtures', name)

const CLI_TIMEOUT_MS = 30_000

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs the compiled CLI; non-zero exits resolve (not reject) with their code. */
async function runCli(args: string[], options: { cwd?: string } = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown }
    if (typeof failed.code !== 'number') throw error // spawn failure, not an exit code
    return {
      code: failed.code,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
      stderr: typeof failed.stderr === 'string' ? failed.stderr : '',
    }
  }
}

beforeAll(async () => {
  // Self-sufficient: build when dist is missing (clean checkout / CI before the
  // build step runs). shell: true so pnpm resolves on both POSIX and Windows.
  try {
    await access(CLI)
  } catch {
    await execFileAsync('pnpm build', { cwd: REPO_ROOT, timeout: 120_000, shell: true })
  }
}, 180_000)

describe('check — gating exit codes', () => {
  it(
    'exits 1 when a critical finding is present (default gate)',
    async () => {
      const result = await runCli(['check', '--file', fixture('mob-st-unadjusted-split.json')])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('gate failed')
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 0 on a clean dataset',
    async () => {
      const result = await runCli(['check', '--file', fixture('ohlcv-valid.csv')])
      expect(result.code).toBe(0)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 1 with --fail-on warning when a warning is present',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--fail-on', 'warning'])
      expect(result.code).toBe(1)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 1 with --fail-on info when any finding is present',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--fail-on', 'info'])
      expect(result.code).toBe(1)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 1 when the score is below --min-score',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--min-score', '90'])
      expect(result.code).toBe(1)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 0 when the score meets --min-score',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--min-score', '80'])
      expect(result.code).toBe(0)
    },
    CLI_TIMEOUT_MS,
  )
})

describe('check — early flag validation (exit 2, no report)', () => {
  it(
    'rejects --fail-on bogus with exit 2 and empty stdout (nothing ran yet)',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--fail-on', 'bogus'])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('--fail-on must be one of')
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'rejects --format bogus with exit 2',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--format', 'bogus'])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('--format must be one of')
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'accepts --format JSON (case-insensitive) and prints parseable JSON on stdout',
    async () => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--format', 'JSON'])
      expect(result.code).toBe(0)
      const report = JSON.parse(result.stdout) as { symbol?: unknown; sanity_score?: unknown }
      expect(report.symbol).toBe('AET.L')
      expect(typeof report.sanity_score).toBe('number')
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 2 with "cannot read file" when the input file does not exist',
    async () => {
      const result = await runCli(['check', '--file', fixture('no-existe.json')])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('cannot read file')
    },
    CLI_TIMEOUT_MS,
  )
})

describe('bare mdsc', () => {
  it(
    'prints help to stdout and exits 0',
    async () => {
      const result = await runCli([])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Usage: mdsc')
    },
    CLI_TIMEOUT_MS,
  )
})

describe('check — config override downgrades a critical to warning', () => {
  const config = JSON.stringify({ rules: { SPLIT_NOT_ADJUSTED: { severity: 'warning' } } })

  async function withTempConfig(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'mdsc-config-'))
    try {
      await writeFile(join(dir, 'mdsc.config.json'), config, 'utf8')
      await run(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it(
    'exits 0 with mdsc.config.json discovered from the process cwd',
    async () => {
      await withTempConfig(async (dir) => {
        const result = await runCli(['check', '--file', fixture('mob-st-unadjusted-split.json')], { cwd: dir })
        expect(result.code).toBe(0)
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'exits 0 with an explicit --config path',
    async () => {
      await withTempConfig(async (dir) => {
        const result = await runCli([
          'check',
          '--file',
          fixture('mob-st-unadjusted-split.json'),
          '--config',
          join(dir, 'mdsc.config.json'),
        ])
        expect(result.code).toBe(0)
      })
    },
    CLI_TIMEOUT_MS,
  )
})
