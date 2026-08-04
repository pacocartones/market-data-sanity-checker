import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { marketDataSetSchema } from '../src/schema/market-data'
import { parseMarketDataJson } from '../src/ingest/index'
import { checkMarketData } from '../src/checker'

/**
 * Golden tests: the report contract, fixed.
 *
 * Every real-case fixture has a hand-REVIEWED golden file with the exact
 * findings (rule, severity, action, where) and sanity_score the corpus must
 * produce. Any change to a rule, a threshold or the scoring model that alters
 * real-case behavior breaks these tests and must be justified in the PR —
 * never "update the goldens" blindly.
 */

interface GoldenFinding {
  rule: string
  severity: string
  action: string
  where: Record<string, string | number> | null
}

interface Golden {
  fixture: string
  sanity_score: number
  findings: GoldenFinding[]
}

const goldenDir = fileURLToPath(new URL('./golden', import.meta.url))
const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))

async function loadGolden(name: string): Promise<Golden> {
  return JSON.parse(await readFile(`${goldenDir}/${name}`, 'utf8')) as Golden
}

const goldenFiles = (await readdir(goldenDir)).filter((name) => name.endsWith('.golden.json'))
const goldens = new Map(await Promise.all(
  goldenFiles.map(async (name) => [name, await loadGolden(name)] as const),
))

describe('golden: the report contract on real-world cases', () => {
  it('has a golden file for every real-case fixture', async () => {
    const covered = new Set([...goldens.values()].map((golden) => golden.fixture))
    const fixtures = (await readdir(fixturesDir)).filter((name) => name.endsWith('.json'))
    for (const fixture of fixtures) {
      expect(covered, `missing golden for fixture ${fixture}`).toContain(fixture)
    }
  })

  for (const [name, golden] of goldens) {
    it(`matches: ${name.replace('.golden.json', '')}`, async () => {
      const raw = await readFile(`${fixturesDir}/${golden.fixture}`, 'utf8')
      const report = checkMarketData(marketDataSetSchema.parse(parseMarketDataJson(raw)))

      expect(report.sanity_score).toBe(golden.sanity_score)
      expect(
        report.findings.map((finding) => ({
          rule: finding.rule,
          severity: finding.severity,
          action: finding.action,
          where: finding.where ?? null,
        })),
      ).toEqual(golden.findings)
    })
  }
})
