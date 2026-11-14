import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mdsc-cli-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

const DANGEROUS_TERMINAL_CHARACTERS = ['\u001b', '\u0007', '\r', '\u202e', '\u2066'] as const

function expectTerminalSafeText(text: string): void {
  for (const character of DANGEROUS_TERMINAL_CHARACTERS) expect(text).not.toContain(character)
}

/** Runs the compiled CLI; non-zero exits resolve (not reject) with their code. */
async function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
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
  it.each([
    ['csv', 'date,open,high,low,close\n2024-01-02T09:30:00-0500,1,1,1,1\n'],
    ['json', JSON.stringify({ symbol: 'X', source: 'synthetic', bars: [{ timestamp: '2024-01-02T09:30:00+0530', open: 1, high: 1, low: 1, close: 1 }] })],
  ])('accepts a timezone offset without a colon in a %s file', async (extension, content) => {
    await withTempDir(async (dir) => {
      const path = join(dir, `input.${extension}`)
      await writeFile(path, content, 'utf8')
      const result = await runCli(['check', '--file', path, '--format', 'json'], { cwd: dir })
      expect(result.code).toBe(0)
      const report = JSON.parse(result.stdout) as { findings: Array<{ rule: string }> }
      expect(report.findings.some((finding) => finding.rule === 'SCHEMA_INVALID')).toBe(false)
    })
  }, CLI_TIMEOUT_MS)

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

  it('keeps non-string schema envelopes in the table gating flow and preserves JSON values', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'non-string-envelope.json')
      await writeFile(
        path,
        JSON.stringify({
          symbol: 42,
          source: 7,
          bars: [{ timestamp: '2024-01-02', open: 1, high: 1, low: 1, close: 1 }],
        }),
      )

      const tableResult = await runCli(['check', '--file', path])
      expect(tableResult.code).toBe(1)
      expect(tableResult.stderr).toContain('gate failed')
      expect(tableResult.stdout).toContain('42 (7) — sanity_score:')
      expect(tableResult.stdout).toContain('SCHEMA_INVALID')

      const jsonResult = await runCli(['check', '--file', path, '--format', 'json'])
      expect(jsonResult.code).toBe(1)
      const report = JSON.parse(jsonResult.stdout) as { symbol?: unknown; source?: unknown }
      expect(report.symbol).toBe(42)
      expect(report.source).toBe(7)
    })
  })

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

  it(
    'prints parseable JSON for the anomalous golden-path fixture before exiting 1',
    async () => {
      await withTempDir(async (dir) => {
        const jsonPath = join(dir, 'report.json')
        const result = await runCli(
          ['check', '--file', fixture('mob-st-unadjusted-split.json'), '--format', 'json'],
          { cwd: dir },
        )

        expect(result.code).toBe(1)
        await writeFile(jsonPath, result.stdout, 'utf8')
        const report = JSON.parse(await readFile(jsonPath, 'utf8')) as {
          symbol?: unknown
          findings?: unknown
        }
        expect(report.symbol).toBe('MOB.ST')
        expect(Array.isArray(report.findings)).toBe(true)
        expect(await readdir(dir)).toEqual(['report.json'])
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'writes a non-empty self-contained HTML report for the anomalous golden-path fixture',
    async () => {
      await withTempDir(async (dir) => {
        const htmlPath = join(dir, 'report.html')
        const result = await runCli(
          ['check', '--file', fixture('mob-st-unadjusted-split.json'), '--html', htmlPath],
          { cwd: dir },
        )

        expect(result.code).toBe(1)
        expect(result.stderr).toContain('HTML dashboard written')
        const html = await readFile(htmlPath, 'utf8')
        expect(html.length).toBeGreaterThan(0)
        expect(html).not.toContain('<script src')
        expect(html).not.toContain('<link')
        const withoutHrefs = html.replace(/href="[^"]*"/g, '')
        expect(withoutHrefs).not.toContain('http://')
        expect(withoutHrefs).not.toContain('https://')
        expect(await readdir(dir)).toEqual(['report.html'])
      })
    },
    CLI_TIMEOUT_MS,
  )
})

describe('check — early flag validation (exit 2, no report)', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects --fail-on %s (an inherited Object.prototype name) instead of passing the gate',
    async (name) => {
      const result = await runCli(['check', '--file', fixture('aet-l-currency-scale.json'), '--fail-on', name])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('--fail-on must be one of')
    },
    CLI_TIMEOUT_MS,
  )

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

describe('history — --limit validation (exit 2, history not read)', () => {
  const historyLine = (at: string, score: number) =>
    JSON.stringify({
      at,
      symbol: 'AAPL',
      source: 'test',
      sanity_score: score,
      summary: { critical: 0, warning: 0, info: 0 },
      rules: [],
    }) + '\n'

  it.each(['abc', '0', '-3', '2.5'])(
    'rejects --limit %s with exit 2 and empty stdout',
    async (limit) => {
      await withTempDir(async (dir) => {
        await writeFile(join(dir, 'AAPL.jsonl'), historyLine('2026-01-01T00:00:00.000Z', 90))
        const result = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir, `--limit=${limit}`])
        expect(result.code).toBe(2)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('mdsc: --limit must be a whole number of at least 1')
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'accepts a valid --limit and shows at most that many entries',
    async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          join(dir, 'AAPL.jsonl'),
          historyLine('2026-01-01T00:00:00.000Z', 80) +
            historyLine('2026-01-02T00:00:00.000Z', 85) +
            historyLine('2026-01-03T00:00:00.000Z', 90),
        )
        const result = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir, '--limit', '2'])
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain('trend: 85 → 90')
        expect(result.stdout).not.toContain('2026-01-01')
      })
    },
    CLI_TIMEOUT_MS,
  )
})

describe('history — --format', () => {
  const entry = (at: string, score: number) => ({
    at,
    symbol: 'AAPL',
    source: 'test',
    sanity_score: score,
    summary: { critical: 0, warning: 1, info: 0 },
    rules: ['STALE_PRICE'],
  })

  it(
    'prints { symbol, entries } with the entries readHistory returns (most recent first)',
    async () => {
      await withTempDir(async (dir) => {
        const entries = [
          entry('2026-01-01T00:00:00.000Z', 80),
          entry('2026-01-02T00:00:00.000Z', 85),
          entry('2026-01-03T00:00:00.000Z', 90),
        ]
        await writeFile(join(dir, 'AAPL.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''))
        const result = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir, '--format', 'json'])
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({ symbol: 'AAPL', entries: [...entries].reverse() })
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'applies --limit to the JSON entries (most recent kept)',
    async () => {
      await withTempDir(async (dir) => {
        const entries = [
          entry('2026-01-01T00:00:00.000Z', 80),
          entry('2026-01-02T00:00:00.000Z', 85),
          entry('2026-01-03T00:00:00.000Z', 90),
        ]
        await writeFile(join(dir, 'AAPL.jsonl'), entries.map((e) => JSON.stringify(e) + '\n').join(''))
        const result = await runCli([
          'history', '--symbol', 'AAPL', '--history-dir', dir, '--format', 'json', '--limit', '2',
        ])
        expect(result.code).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({ symbol: 'AAPL', entries: [entries[2], entries[1]] })
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'prints an empty entries array (not the hint) and exits 0 when there is no history',
    async () => {
      await withTempDir(async (dir) => {
        const result = await runCli(['history', '--symbol', 'MSFT', '--history-dir', dir, '--format', 'json'])
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({ symbol: 'MSFT', entries: [] })
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'rejects an unknown --format with exit 2 before reading the history',
    async () => {
      await withTempDir(async (dir) => {
        await writeFile(join(dir, 'AAPL.jsonl'), JSON.stringify(entry('2026-01-01T00:00:00.000Z', 90)) + '\n')
        const result = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir, '--format', 'xml'])
        expect(result.code).toBe(2)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('mdsc: --format must be one of: table, json')
      })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'keeps the table as the default output',
    async () => {
      await withTempDir(async (dir) => {
        await writeFile(join(dir, 'AAPL.jsonl'), JSON.stringify(entry('2026-01-01T00:00:00.000Z', 90)) + '\n')
        const result = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir])
        expect(result.code).toBe(0)
        expect(result.stdout).toContain('Audit history — AAPL')
      })
    },
    CLI_TIMEOUT_MS,
  )

  it('keeps hand-edited history terminal-safe while preserving JSON values', async () => {
    await withTempDir(async (dir) => {
      const hostile = {
        ...entry('2026-\u001b[2J\nspoof', 90),
        summary: {
          critical: '1\nforged\u202e',
          warning: '0\u001b[2J',
          info: 0,
        },
        rules: ['RULE\u001b]8;;https://evil.example\u0007\nforged\u202e'],
      }
      await writeFile(join(dir, 'AAPL.jsonl'), JSON.stringify(hostile) + '\n')

      const tableResult = await runCli(['history', '--symbol', 'AAPL', '--history-dir', dir])
      expect(tableResult.code).toBe(0)
      expectTerminalSafeText(tableResult.stdout)
      expect(tableResult.stdout).toContain('\\n')
      expect(tableResult.stdout).toContain('\\u202E')
      expect(tableResult.stdout).not.toContain('evil.example')

      const jsonResult = await runCli([
        'history',
        '--symbol',
        'AAPL',
        '--history-dir',
        dir,
        '--format',
        'json',
      ])
      expect(jsonResult.code).toBe(0)
      expect(JSON.parse(jsonResult.stdout)).toEqual({ symbol: 'AAPL', entries: [hostile] })
    })
  })

  it('keeps an empty-history symbol inside one terminal-safe guidance block', async () => {
    await withTempDir(async (dir) => {
      const symbol = 'AA\u001b]8;;https://evil.example\u0007PL\u001b]8;;\u0007\nspoof\u202e'
      const result = await runCli(['history', '--symbol', symbol, '--history-dir', dir])

      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expectTerminalSafeText(result.stdout)
      expect(result.stdout).toContain('\\n')
      expect(result.stdout).toContain('\\u202E')
      expect(result.stdout).not.toContain('evil.example')
    })
  })
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

describe('rules — catalog listing', () => {
  it('prints the references of compare rules too', async () => {
    const { code, stdout } = await runCli(['rules'])
    expect(code).toBe(0)
    const compareSection = stdout.slice(stdout.indexOf('compare rules'))
    expect(compareSection).toMatch(/SPLIT_MISMATCH[\s\S]*?ref: https?:\/\//)
    expect((stdout.match(/^ {4}ref: /gm) ?? []).length).toBeGreaterThanOrEqual(36)
  })

  // Regression for #108: the rules command used to do strict-equality on
  // options.format === 'json', so `--format JSON` silently printed a table
  // and `--format yaml` fell through to the table branch instead of erroring.
  // The check/compare commands already did both correctly via validateCommonFlags;
  // rules now mirrors them.
  it('accepts --format JSON (case-insensitive) and prints parseable JSON on stdout', async () => {
    const result = await runCli(['rules', '--format', 'JSON'])
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout) as {
      single_source?: unknown[]
      compare?: unknown[]
    }
    expect(Array.isArray(report.single_source)).toBe(true)
    expect(Array.isArray(report.compare)).toBe(true)
    expect((report.single_source ?? []).length).toBeGreaterThan(0)
  })

  it('exits 2 on unknown --format with the same message as check/compare', async () => {
    const result = await runCli(['rules', '--format', 'yaml'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--format must be one of: table, json')
  })

  // Feature for #74: `mdsc rules <ID>` prints only that rule.
  it('prints a single rule when given an id (case-insensitive, table format)', async () => {
    // SERIES_TAIL_TRUNCATED is a known compare rule; SPLIT_NOT_ADJUSTED is a single-source rule.
    const result = await runCli(['rules', 'series_tail_truncated'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('SERIES_TAIL_TRUNCATED')
    // Should NOT contain other rules' IDs.
    expect(result.stdout).not.toMatch(/SPLIT_NOT_ADJUSTED/)
    // Should not contain the catalog header (single-rule output is per-rule only).
    expect(result.stdout).not.toMatch(/single-source rules/)
  })

  it('finds a rule in the single-source registry too (uppercase id, table format)', async () => {
    const result = await runCli(['rules', 'SPLIT_NOT_ADJUSTED'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('SPLIT_NOT_ADJUSTED')
    expect(result.stdout).not.toMatch(/SERIES_TAIL_TRUNCATED/)
  })

  it('prints only the rule\'s meta object when given an id and --format json', async () => {
    const result = await runCli(['rules', 'SERIES_TAIL_TRUNCATED', '--format', 'json'])
    expect(result.code).toBe(0)
    const meta = JSON.parse(result.stdout) as { id?: string; severity?: string }
    expect(meta.id).toBe('SERIES_TAIL_TRUNCATED')
    expect(typeof meta.severity).toBe('string')
  })

  it('exits 1 on unknown id and suggests up to 3 prefix matches', async () => {
    // "SPLIT" is a common prefix that matches at least SPLIT_NOT_ADJUSTED and SPLIT_MISMATCH.
    const result = await runCli(['rules', 'SPLIT_NOTHING_LIKE_THIS'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown rule "SPLIT_NOTHING_LIKE_THIS"')
    // Should suggest rules that start with "SPLIT" (case-insensitive prefix).
    expect(result.stderr).toContain('did you mean')
    // At least one of the suggested ids should start with SPLIT.
    expect(result.stderr).toMatch(/SPLIT_/)
  })

  it('exits 1 on unknown id with no prefix matches (no "did you mean" hint)', async () => {
    const result = await runCli(['rules', 'ZZZ_NONEXISTENT_ZZZ'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown rule "ZZZ_NONEXISTENT_ZZZ"')
    expect(result.stderr).not.toMatch(/did you mean/)
  })

  it('keeps an unknown rule id on one terminal-safe diagnostic line', async () => {
    const id = 'ZZZ\u001b]8;;https://evil.example\u0007BAD\u001b]8;;\u0007\nspoof\u202e'
    const result = await runCli(['rules', id])

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expectTerminalSafeText(result.stderr)
    expect(result.stderr.trimEnd().split('\n')).toHaveLength(1)
    expect(result.stderr).toContain('\\n')
    expect(result.stderr).toContain('\\u202E')
    expect(result.stderr).not.toContain('evil.example')
  })
})

describe('compare — error paths and exit codes', () => {
  it('exits 2 when --files has fewer than two paths', async () => {
    const result = await runCli(['compare', '--files', 'one.csv'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--files needs exactly two paths separated by a comma')
  })

  it('exits 2 when neither --files nor --symbol is provided', async () => {
    const result = await runCli(['compare'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--symbol is required when comparing providers')
  })

  it('exits 2 when --symbol is given without --providers', async () => {
    const result = await runCli(['compare', '--symbol', 'AAPL'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--providers needs two providers')
  })

  it('exits 2 on invalid --format and keeps stdout empty', async () => {
    const result = await runCli(['compare', '--files', 'a.csv,b.csv', '--format', 'bogus'])
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--format must be one of: table, json, markdown')
  })

  it('exits 2 on invalid --fail-on and keeps stdout empty', async () => {
    const result = await runCli(['compare', '--files', 'a.csv,b.csv', '--fail-on', 'bogus'])
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--fail-on must be one of:')
  })

  it('exits 2 on invalid --min-score and keeps stdout empty', async () => {
    const result = await runCli(['compare', '--files', 'a.csv,b.csv', '--min-score', '500'])
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--min-score must be a number between 0 and 100')
  })

  it('exits 0 on happy path compare --files and prints consistency_score with --format json', async () => {
    const validFile = fixture('ohlcv-valid.csv')
    const result = await runCli(['compare', '--files', `${validFile},${validFile}`, '--format', 'json'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('consistency_score')
    const report = JSON.parse(result.stdout) as { consistency_score?: number }
    expect(report.consistency_score).toBe(100)
  })

  it('renders markdown table on compare --files with --format markdown', async () => {
    const validFile = fixture('ohlcv-valid.csv')
    const result = await runCli(['compare', '--files', `${validFile},${validFile}`, '--format', 'markdown'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('consistency_score: 100/100')
    expect(result.stdout).toContain('No findings.')
  })

  it('renders markdown table on check --file with --format markdown (with findings and when clean)', async () => {
    const cleanResult = await runCli(['check', '--file', fixture('ge-reverse-split.json'), '--format', 'markdown'])
    expect(cleanResult.code).toBe(0)
    expect(cleanResult.stdout).toContain('sanity_score: 100/100')
    expect(cleanResult.stdout).toContain('No findings.')

    const findingsResult = await runCli(['check', '--file', fixture('berkshire-bad-tick.json'), '--format', 'markdown'])
    expect(findingsResult.code).toBe(1)
    expect(findingsResult.stdout).toContain('| Rule | Severity | Date | Explanation |')
    expect(findingsResult.stdout).toContain('PRICE_SPIKE_INTRADAY')
  })

  it('keeps a hostile --symbol inside the markdown heading line', async () => {
    // The reproduction from the review of #200: --symbol reaches the heading verbatim
    // and the output is read as markdown in a PR comment or GITHUB_STEP_SUMMARY. The
    // csv fixture carries no symbol, so the override is the one that is rendered.
    const hostile = 'AAPL\n\n[free prize](https://evil.example) <img src=x onerror=alert(1)>'
    const result = await runCli(['check', '--file', fixture('ohlcv-valid.csv'), '--symbol', hostile, '--format', 'markdown'])
    expect(result.code).toBe(0)
    // one heading line, break collapsed to a space, markdown and html punctuation escaped
    expect(result.stdout.split('\n')[0]).toBe(
      '## AAPL \\[free prize\\](https://evil.example) \\<img src=x onerror=alert(1)\\> (csv) — sanity_score: 80/100',
    )
  })

  it('neutralizes terminal controls in table output while preserving JSON data', async () => {
    const symbol = 'AAPL\u001b[2J\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007\r\u202e'
    const source = 'feed\u001b]52;c;Y2xpcGJvYXJk\u0007\u2066'
    const args = ['check', '--file', fixture('ohlcv-valid.csv'), '--symbol', symbol, '--source', source]

    const tableResult = await runCli(args)
    expectTerminalSafeText(tableResult.stdout)
    expect(tableResult.stdout).toContain('AAPLlink\\r\\u202E')
    expect(tableResult.stdout).not.toContain('evil.example')
    expect(tableResult.stdout).not.toContain('Y2xpcGJvYXJk')

    const jsonResult = await runCli([...args, '--format', 'json'])
    const report = JSON.parse(jsonResult.stdout) as { symbol?: unknown; source?: unknown }
    expect(report.symbol).toBe(symbol)
    expect(report.source).toBe(source)
  })

  it('keeps a crafted CSV header error on one terminal-safe stderr line', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'crafted.csv')
      const hostileColumn = 'cl\u001b]8;;https://evil.example\u0007o\nspoof\u001b]8;;\u0007se\u202e'
      await writeFile(
        path,
        `date,open,high,low,"${hostileColumn}"\n2024-01-02,1,1,1,1\n`,
        'utf8',
      )

      const result = await runCli(['check', '--file', path])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expectTerminalSafeText(result.stderr)
      expect(result.stderr.trimEnd().split('\n')).toHaveLength(1)
      expect(result.stderr).toContain('\\n')
      expect(result.stderr).toContain('\\u202E')
      expect(result.stderr).not.toContain('evil.example')
    })
  })

  it('neutralizes terminal controls reflected by a compare error path', async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, 'missing\u001b[2J\u202e.csv')
      const result = await runCli([
        'compare',
        '--files',
        `${missing},${fixture('ohlcv-valid.csv')}`,
      ])

      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expectTerminalSafeText(result.stderr)
      expect(result.stderr).toContain('\\u202E')
    })
  })

  it('neutralizes terminal controls in written-path confirmations', async () => {
    await withTempDir(async (dir) => {
      const html = join(dir, 'dashboard\u202e.html')
      const historyDir = join(dir, 'history\u2066')

      const htmlResult = await runCli(['check', '--file', fixture('ohlcv-valid.csv'), '--html', html])
      expect(htmlResult.code).toBe(0)
      expectTerminalSafeText(htmlResult.stderr)
      expect(htmlResult.stderr).toContain('\\u202E')
      await access(html)

      const historyResult = await runCli([
        'check',
        '--file',
        fixture('ohlcv-valid.csv'),
        '--save',
        '--history-dir',
        historyDir,
      ])
      expect(historyResult.code).toBe(0)
      expectTerminalSafeText(historyResult.stderr)
      expect(historyResult.stderr).toContain('\\u2066')
    })
  })
})

describe('providers — --format', () => {
  // A dummy key makes alpha-vantage "ready" without any network call; yahoo needs nothing and has no cap.
  const envWith = (extra: Record<string, string>): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
    if (!('ALPHA_VANTAGE_PREMIUM' in extra)) delete env.ALPHA_VANTAGE_PREMIUM
    return env
  }

  it(
    'prints each provider with daily_request_limit (a number for a capped one, null otherwise)',
    async () => {
      const result = await runCli(['providers', '--format', 'json'], {
        env: envWith({ ALPHA_VANTAGE_API_KEY: 'dummy' }),
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const providers = JSON.parse(result.stdout) as Array<Record<string, unknown>>
      const byName = Object.fromEntries(providers.map((p) => [p.name, p]))
      expect(Object.keys(byName).sort()).toEqual(['alpha-vantage', 'yahoo'])
      for (const provider of providers) {
        expect(Object.keys(provider).sort()).toEqual(['available', 'daily_request_limit', 'name', 'requires'])
        expect(typeof provider.requires).toBe('string')
      }
      expect(byName['alpha-vantage']).toMatchObject({ available: true, daily_request_limit: 25 })
      expect(byName.yahoo).toMatchObject({ available: true, daily_request_limit: null })
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'reports null for alpha-vantage with a premium key (no daily cap)',
    async () => {
      const result = await runCli(['providers', '--format', 'JSON'], {
        env: envWith({ ALPHA_VANTAGE_API_KEY: 'dummy', ALPHA_VANTAGE_PREMIUM: 'true' }),
      })
      expect(result.code).toBe(0)
      const providers = JSON.parse(result.stdout) as Array<{ name: string; daily_request_limit: number | null }>
      expect(providers.find((p) => p.name === 'alpha-vantage')?.daily_request_limit).toBeNull()
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'shows the cap after "ready" in the table, and nothing extra for a provider without one',
    async () => {
      const result = await runCli(['providers'], { env: envWith({ ALPHA_VANTAGE_API_KEY: 'dummy' }) })
      expect(result.code).toBe(0)
      const lines = result.stdout.split('\n')
      expect(lines.find((line) => line.trim().startsWith('alpha-vantage'))).toMatch(/ready · 25 requests\/day$/)
      expect(lines.find((line) => line.trim().startsWith('yahoo'))?.trimEnd()).toMatch(/ready$/)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'rejects an unknown --format with exit 2 and empty stdout',
    async () => {
      const result = await runCli(['providers', '--format', 'xml'])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('--format must be one of: table, json')
    },
    CLI_TIMEOUT_MS,
  )
})
