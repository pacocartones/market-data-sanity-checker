import { execFile } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import {
  REPORT_SCHEMA_NAMES,
  checkReportSchema,
  compareReportSchema,
  findingSchema,
  reportJsonSchema,
  reportSchemaFile,
} from '../src/report/schema'
import type { Finding, SanityReport } from '../src/report/types'
import type { ComparisonReport } from '../src/compare/comparator'
import { marketDataSetSchema } from '../src/schema/market-data'
import { parseMarketDataJson } from '../src/ingest/index'
import { checkMarketData } from '../src/checker'
import { compareDatasets } from '../src/compare/comparator'
import * as library from '../src/index'

/**
 * The published JSON Schemas of the check and compare reports (schemas/*.v1.json):
 * generated from the zod schemas in src/report/schema.ts, which must describe
 * exactly the report interfaces and accept the real output.
 */

const execFileAsync = promisify(execFile)
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(REPO_ROOT, 'dist', 'cli.js')
const fixturesDir = join(REPO_ROOT, 'tests', 'fixtures')
const goldenDir = join(REPO_ROOT, 'tests', 'golden')
const fixture = (name: string) => join(fixturesDir, name)
const CLI_TIMEOUT_MS = 30_000

describe('report schemas: types', () => {
  it('z.infer of each schema and the report interfaces are mutually assignable', () => {
    expectTypeOf<z.infer<typeof findingSchema>>().toExtend<Finding>()
    expectTypeOf<Finding>().toExtend<z.infer<typeof findingSchema>>()
    expectTypeOf<z.infer<typeof checkReportSchema>>().toExtend<SanityReport>()
    expectTypeOf<SanityReport>().toExtend<z.infer<typeof checkReportSchema>>()
    expectTypeOf<z.infer<typeof compareReportSchema>>().toExtend<ComparisonReport>()
    expectTypeOf<ComparisonReport>().toExtend<z.infer<typeof compareReportSchema>>()
  })

  it('exports the zod schemas from the package entry point', () => {
    expect(library.checkReportSchema).toBe(checkReportSchema)
    expect(library.compareReportSchema).toBe(compareReportSchema)
  })
})

describe('report schemas: published files', () => {
  for (const name of REPORT_SCHEMA_NAMES) {
    it(`schemas/${reportSchemaFile(name)} matches the generated output (run pnpm schemas)`, async () => {
      const committed = await readFile(join(REPO_ROOT, 'schemas', reportSchemaFile(name)), 'utf8')
      expect(committed).toBe(`${JSON.stringify(reportJsonSchema(name), null, 2)}\n`)
    })
  }

  it('carries $schema, $id, title and description', () => {
    for (const name of REPORT_SCHEMA_NAMES) {
      const schema = reportJsonSchema(name)
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      expect(schema.$id).toBe(
        `https://pacocartones.github.io/market-data-sanity-checker/schemas/${name}-report.v1.json`,
      )
      expect(typeof schema.title).toBe('string')
      expect(typeof schema.description).toBe('string')
    }
  })

  it('is shipped in the package and exported as subpaths', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      files: string[]
      exports: Record<string, unknown>
    }
    expect(pkg.files).toContain('schemas')
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' })
    for (const name of REPORT_SCHEMA_NAMES) {
      const file = `./schemas/${reportSchemaFile(name)}`
      expect(pkg.exports[file]).toBe(file)
    }
  })
})

async function loadFixture(name: string) {
  return marketDataSetSchema.parse(parseMarketDataJson(await readFile(fixture(name), 'utf8')))
}

describe('report schemas: real reports validate', () => {
  it('every golden fixture produces a check report the schema accepts', async () => {
    const goldens = (await readdir(goldenDir)).filter((name) => name.endsWith('.golden.json'))
    expect(goldens.length).toBeGreaterThan(0)
    for (const name of goldens) {
      const golden = JSON.parse(await readFile(join(goldenDir, name), 'utf8')) as {
        fixture: string
        findings: Array<{ rule: string; severity: string; action: string }>
      }
      // The golden itself is a projection of the report (rule, severity, action, where);
      // its enum values must be valid finding values.
      for (const finding of golden.findings) {
        expect(findingSchema.pick({ rule: true, severity: true, action: true }).safeParse(finding).success).toBe(true)
      }
      const report = checkMarketData(await loadFixture(golden.fixture))
      const parsed = checkReportSchema.safeParse(report)
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })

  it('compare reports between golden fixtures validate', async () => {
    const pairs: Array<[string, string]> = [
      ['mob-st-unadjusted-split.json', 'bars-array.json'],
      ['berkshire-bad-tick.json', 'berkshire-bad-tick.json'],
      ['alc-sw-duplicated-dividend.json', 'hlcl-l-dividend-100x.json'],
    ]
    for (const [a, b] of pairs) {
      const report = compareDatasets(await loadFixture(a), await loadFixture(b))
      const parsed = compareReportSchema.safeParse(report)
      expect(parsed.success, `${a} vs ${b}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })

  it('rejects a finding with an unknown severity', () => {
    const valid: SanityReport = {
      symbol: 'X',
      source: 'test',
      sanity_score: 60,
      findings: [{ rule: 'R', severity: 'critical', action: 'block', dimension: 'validity', explanation: 'x' }],
      summary: { critical: 1, warning: 0, info: 0 },
      generated_at: '2026-11-27T00:00:00.000Z',
    }
    expect(checkReportSchema.safeParse(valid).success).toBe(true)
    const bad = {
      ...valid,
      findings: [{ rule: 'R', severity: 'fatal', action: 'block', dimension: 'validity', explanation: 'x' }],
    }
    const parsed = checkReportSchema.safeParse(bad)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['findings', 0, 'severity'])
  })
})

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown }
    if (typeof failed.code !== 'number') throw error
    return {
      code: failed.code,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
      stderr: typeof failed.stderr === 'string' ? failed.stderr : '',
    }
  }
}

describe('report schemas: CLI', () => {
  beforeAll(async () => {
    try {
      await access(CLI)
    } catch {
      await execFileAsync('pnpm build', { cwd: REPO_ROOT, timeout: 120_000, shell: true })
    }
  }, 180_000)

  it('mdsc check --format json output validates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mdsc-schema-'))
    // A structurally invalid dataset: the blocked SCHEMA_INVALID report must validate too.
    const invalid = join(dir, 'invalid.json')
    await writeFile(invalid, JSON.stringify({ symbol: 'BAD', source: 'test', bars: [{ timestamp: 'x', open: 'a' }] }), 'utf8')
    try {
      for (const name of [
        fixture('mob-st-unadjusted-split.json'),
        fixture('ohlcv-valid.csv'),
        fixture('ohlcv-zero-volume-moved.csv'),
        fixture('bars-array.json'),
        invalid,
      ]) {
        const result = await runCli(['check', '--file', name, '--format', 'json'])
        expect(result.code, result.stderr).toBeLessThan(2)
        const parsed = checkReportSchema.safeParse(JSON.parse(result.stdout))
        expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
        if (name === invalid) expect(parsed.data?.findings[0]?.rule).toBe('SCHEMA_INVALID')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, CLI_TIMEOUT_MS * 5)

  it('mdsc compare --format json output validates', async () => {
    for (const [a, b] of [
      ['mob-st-unadjusted-split.json', 'bars-array.json'],
      ['ohlcv-valid.csv', 'ohlcv-zero-volume-moved.csv'],
    ]) {
      const result = await runCli(['compare', '--files', `${fixture(a!)},${fixture(b!)}`, '--format', 'json'])
      expect(result.code, result.stderr).toBeLessThan(2)
      const parsed = compareReportSchema.safeParse(JSON.parse(result.stdout))
      expect(parsed.success, `${a} vs ${b}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  }, CLI_TIMEOUT_MS * 2)

  it('mdsc schema <check|compare> prints the published schema and exits 0', async () => {
    for (const name of REPORT_SCHEMA_NAMES) {
      const result = await runCli(['schema', name])
      expect(result.code, result.stderr).toBe(0)
      const committed = await readFile(join(REPO_ROOT, 'schemas', reportSchemaFile(name)), 'utf8')
      expect(JSON.parse(result.stdout)).toEqual(JSON.parse(committed))
    }
  }, CLI_TIMEOUT_MS * 2)

  it('mdsc schema with an unknown or missing name exits 2 with a clear message', async () => {
    const unknown = await runCli(['schema', 'history'])
    expect(unknown.code).toBe(2)
    expect(unknown.stdout).toBe('')
    expect(unknown.stderr).toContain('mdsc: unknown schema "history"; must be one of: check, compare')
    const missing = await runCli(['schema'])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('must be one of: check, compare')
  }, CLI_TIMEOUT_MS * 2)
})
