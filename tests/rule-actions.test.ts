import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCompareContext } from '../src/compare/engine'
import { compareRegistry } from '../src/compare/registry'
import { parseMarketDataJson } from '../src/ingest/index'
import { ACTION_FOR_SEVERITY, type Finding, type Severity } from '../src/report/types'
import { buildDataProfile } from '../src/rules/engine'
import { registry } from '../src/rules/registry'
import type { DataProfile } from '../src/rules/types'
import { marketDataSetSchema, type Bar, type MarketDataSet } from '../src/schema/market-data'

/**
 * Both engines set every reported finding's action from its severity. A
 * direct `rule.check()` call (documented in the README) must return the same
 * pair, so every rule derives its action with `actionForSeverity` instead of
 * a literal. This runs every registered rule, single-source and compare, on
 * datasets that make it fire, under each configured severity, and checks
 * `finding.action === ACTION_FOR_SEVERITY[finding.severity]`.
 */

const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

interface SingleCase {
  name: string
  data: MarketDataSet
  profile?: DataProfile
}

interface PairCase {
  name: string
  a: MarketDataSet
  b: MarketDataSet
}

/** Consecutive calendar days from 2024-01-01; OHLC derived from the close. */
function bars(closes: number[], volume: number | undefined = 1000, start = Date.UTC(2024, 0, 1)): Bar[] {
  return closes.map((close, index) => ({
    timestamp: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    open: close * 0.999,
    high: close * 1.005,
    low: close * 0.995,
    close,
    ...(volume === undefined ? {} : { volume }),
  }))
}

function dataset(barList: Bar[], extra: Partial<MarketDataSet> = {}): MarketDataSet {
  return { symbol: 'TEST', source: 'synthetic', currency: 'USD', bars: barList, ...extra }
}

const steady = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i) + 0.0005 * i))

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))
const realCases: SingleCase[] = readdirSync(fixturesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    data: marketDataSetSchema.parse(parseMarketDataJson(readFileSync(`${fixturesDir}/${name}`, 'utf8'))),
  }))

const hlcl = realCases.find((entry) => entry.name === 'hlcl-l-dividend-100x.json')!.data

const spikeCloses = steady.slice(0, 16)
spikeCloses[15] = spikeCloses[14]! * (1 - 0.057)

const syntheticCases: SingleCase[] = [
  { name: 'negative volume', data: dataset(bars(steady).map((bar, i) => (i === 5 ? { ...bar, volume: -5 } : bar))) },
  { name: 'zero close', data: dataset(bars(steady).map((bar, i) => (i === 5 ? { ...bar, close: 0 } : bar))) },
  { name: 'zero volume, moving bar', data: dataset(bars(steady).map((bar, i) => (i === 5 ? { ...bar, volume: 0 } : bar))) },
  { name: 'newest first', data: dataset(bars(steady).reverse()) },
  {
    name: 'one swapped pair',
    data: dataset(bars(steady).map((bar, i, all) => (i === 5 ? all[6]! : i === 6 ? all[5]! : bar))),
  },
  { name: 'two-week gap', data: dataset([...bars(steady.slice(0, 10)), ...bars(steady.slice(10), 1000, Date.UTC(2024, 0, 25))]) },
  { name: 'few bars', data: dataset(bars([100, 101, 102])) },
  { name: 'no bars (critical escalation)', data: dataset([]) },
  {
    name: 'long zero-volume stale run (info)',
    data: dataset(bars(Array.from({ length: 11 }, () => 1520.5), 0).map((bar) => ({ ...bar, high: 1520.5, low: 1520.5, open: 1520.5 }))),
  },
  {
    name: 'earnings-scale return outlier (info)',
    data: dataset(bars(spikeCloses)),
    profile: { returns: Array.from({ length: 15 }, () => 0.001), medianReturn: 0, madReturn: 0.0085 },
  },
  { name: 'GBP label on pence magnitudes', data: dataset(bars([4490, 4500, 4510, 4505, 4495]), { symbol: 'VOD.L', currency: 'GBP' }) },
  { name: 'missing currency (info)', data: { symbol: 'VOD.L', source: 'synthetic', bars: bars([70, 71, 72]) } },
  {
    name: 'large special dividend (info)',
    data: { ...hlcl, dividends: [{ exDate: '2024-06-10', amount: 0.65, type: 'special' }] },
  },
  {
    name: 'pay date before ex-date',
    data: dataset(bars(Array.from({ length: 10 }, () => 10), 1000, Date.UTC(2023, 4, 1)), {
      dividends: [{ exDate: '2023-05-10', payDate: '2023-05-05', amount: 0.21 }],
    }),
  },
  {
    name: 'isolated regular dividend far above the median',
    data: dataset([], {
      dividends: [
        ...['2023-01-15', '2023-04-15', '2023-07-15', '2023-10-15', '2024-01-15'].map((exDate) => ({
          exDate,
          amount: 0.1,
          type: 'regular' as const,
        })),
        { exDate: '2024-06-15', amount: 1, type: 'regular' },
      ],
    }),
  },
  { name: 'identity split', data: dataset(bars(steady), { splits: [{ exDate: '2024-01-10', numerator: 1, denominator: 1 }] }) },
  {
    name: 'near-one split (info)',
    data: dataset(bars(steady), { splits: [{ exDate: '2024-01-10', numerator: 21, denominator: 20 }] }),
  },
  { name: 'negative payout', data: dataset(bars(steady), { fundamentals: { payoutRatio: -0.5 } }) },
  { name: 'payout above the bound', data: dataset(bars(steady), { fundamentals: { payoutRatio: 4 } }) },
  { name: 'P/E sign against EPS', data: dataset(bars(steady), { fundamentals: { pe: 25, eps: -1.2 } }) },
  { name: 'negative market cap', data: dataset(bars(steady), { fundamentals: { marketCap: -1 } }) },
]

const singleCases = [...realCases, ...syntheticCases]

const base = dataset(bars(Array.from({ length: 20 }, () => 100)))
const pairCases: PairCase[] = [
  { name: 'different symbols', a: base, b: { ...base, symbol: 'OTHER' } },
  { name: 'little overlap', a: dataset(base.bars.slice(0, 3)), b: dataset(base.bars.slice(0, 3)) },
  { name: 'no overlap (critical escalation)', a: dataset(base.bars.slice(0, 5)), b: dataset(base.bars.slice(10, 15)) },
  { name: 'truncated tail', a: base, b: dataset(base.bars.slice(0, 17)) },
  { name: 'closes 5% apart', a: base, b: dataset(bars(Array.from({ length: 20 }, () => 105))) },
  { name: 'volumes 3x apart', a: base, b: dataset(bars(Array.from({ length: 20 }, () => 100), 3000)) },
  { name: 'dividend in one source only', a: { ...base, dividends: [{ exDate: '2024-01-10', amount: 0.5 }] }, b: base },
  {
    name: 'split in one source only',
    a: { ...base, splits: [{ exDate: '2024-01-10', numerator: 2, denominator: 1 }] },
    b: base,
  },
]

function assertActions(findings: Finding[], label: string): void {
  for (const finding of findings) {
    expect(finding.action, `${label}: ${finding.severity} finding`).toBe(ACTION_FOR_SEVERITY[finding.severity])
  }
}

describe('rule actions follow severity on direct check() calls', () => {
  const fired = new Map<string, Set<Severity>>()
  const record = (findings: Finding[]) => {
    for (const finding of findings) {
      const seen = fired.get(finding.rule) ?? new Set<Severity>()
      seen.add(finding.severity)
      fired.set(finding.rule, seen)
    }
  }

  it.each(registry.map((rule) => [rule.meta.id, rule] as const))('%s', (id, rule) => {
    let count = 0
    for (const { name, data, profile } of singleCases) {
      for (const severity of SEVERITIES) {
        const findings = rule.check(data, {
          config: { severity, params: { ...rule.meta.defaultParams } },
          profile: profile ?? buildDataProfile(data),
        })
        assertActions(findings, `${id} on ${name} (configured ${severity})`)
        if (severity === rule.meta.severity) record(findings)
        count += findings.length
      }
    }
    expect(count, `${id} never fired; add a case that makes it fire`).toBeGreaterThan(0)
  })

  it.each(compareRegistry.map((rule) => [rule.meta.id, rule] as const))('%s', (id, rule) => {
    let count = 0
    for (const { name, a, b } of pairCases) {
      for (const severity of SEVERITIES) {
        const findings = rule.check(a, b, {
          config: { severity, params: { ...rule.meta.defaultParams } },
          ...buildCompareContext(a, b),
        })
        assertActions(findings, `${id} on ${name} (configured ${severity})`)
        if (severity === rule.meta.severity) record(findings)
        count += findings.length
      }
    }
    expect(count, `${id} never fired; add a case that makes it fire`).toBeGreaterThan(0)
  })

  it('exercises every deliberate per-occurrence severity', () => {
    const expected: Array<[string, Severity]> = [
      ['INSUFFICIENT_DATA', 'critical'],
      ['INSUFFICIENT_OVERLAP', 'critical'],
      ['RETURN_SPIKE', 'info'],
      ['STALE_PRICE', 'info'],
      ['CURRENCY_SUSPECT', 'info'],
      ['CURRENCY_SUSPECT', 'warning'],
      ['DIV_SCALE_100X', 'info'],
      ['DIV_SCALE_100X', 'warning'],
      ['SPLIT_RATIO_IMPROBABLE', 'info'],
      ['SPLIT_RATIO_IMPROBABLE', 'warning'],
    ]
    for (const [rule, severity] of expected) {
      expect([...(fired.get(rule) ?? [])], rule).toContain(severity)
    }
  })
})
