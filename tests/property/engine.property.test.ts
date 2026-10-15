import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkMarketData } from '../../src/checker'
import { ACTION_FOR_SEVERITY, runRules } from '../../src/rules/engine'
import { registry } from '../../src/rules/registry'
import { SEVERITY_ORDER } from '../../src/report/types'
import { computeSanityScore, summarize } from '../../src/scoring/score'
import { marketDataSetSchema, type MarketDataSet } from '../../src/schema/market-data'
import { cleanDataset, validDataset, wildDataset } from './support/arbitraries'
import { check } from './support/config'

const RULE_IDS = new Set(registry.map((rule) => rule.meta.id))
const DIMENSIONS = ['completeness', 'validity', 'accuracy', 'consistency', 'timeliness', 'uniqueness']

/** The report minus its wall-clock field (the only legitimately non-deterministic part). */
function stable(report: ReturnType<typeof checkMarketData>) {
  const { generated_at: _generatedAt, ...rest } = report
  return rest
}

/** Every date a finding is allowed to point at: bar timestamps and corporate-action ex-dates. */
function knownDates(data: MarketDataSet): Set<string> {
  return new Set([
    ...data.bars.map((bar) => bar.timestamp),
    ...(data.dividends ?? []).map((dividend) => dividend.exDate),
    ...(data.splits ?? []).map((split) => split.exDate),
  ])
}

describe('arbitraries (guard the generators themselves)', () => {
  // WHY: a property that runs on invalid input proves nothing. If a generator
  // drifts away from the schema, every other property silently weakens.
  it('wild, valid and clean datasets all satisfy the Zod schema', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset(), cleanDataset()), (data) => {
        expect(marketDataSetSchema.safeParse(data).success).toBe(true)
      }),
    )
  })

  it('valid datasets keep high >= max(open, close), low <= min(open, close), positive prices, ascending distinct timestamps', () => {
    check(
      fc.property(validDataset(), (data) => {
        let previous = Number.NEGATIVE_INFINITY
        for (const bar of data.bars) {
          expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close))
          expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close))
          expect(bar.low).toBeGreaterThan(0)
          const time = Date.parse(bar.timestamp)
          expect(time).toBeGreaterThan(previous)
          previous = time
        }
      }),
    )
  })
})

describe('(a) the engine never throws on a schema-valid dataset', () => {
  // WHY: the rule contract says rules are total functions ("a trust layer must
  // never crash"); the engine wraps a throwing rule into an Error, so any
  // exception here is a rule that violated the contract on legal input.
  it('runRules and checkMarketData return for any schema-valid dataset', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset()), (data) => {
        expect(() => checkMarketData(data)).not.toThrow()
      }),
    )
  })
})

describe('(b) score range and determinism', () => {
  // WHY: sanity_score = max(0, 100 - sum of penalties) with penalties 40/15/5,
  // so it is an integer in [0, 100]; consumers gate on it (`--min-score`).
  // NaN or a value outside the band would break every threshold comparison.
  it('sanity_score is a finite integer in [0, 100] and equals the documented formula', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset()), (data) => {
        const report = checkMarketData(data)
        expect(Number.isFinite(report.sanity_score)).toBe(true)
        expect(Number.isInteger(report.sanity_score)).toBe(true)
        expect(report.sanity_score).toBeGreaterThanOrEqual(0)
        expect(report.sanity_score).toBeLessThanOrEqual(100)
        expect(report.sanity_score).toBe(computeSanityScore(report.findings))
        expect(report.summary).toEqual(summarize(report.findings))
      }),
    )
  })

  // WHY: reports are diffed, golden-tested and stored in history; the same
  // input must give the same report (generated_at aside). Also, the tool
  // promises "flag, don't delete": the input must never be mutated.
  it('is deterministic and never mutates its input', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset()), (data) => {
        const before = structuredClone(data)
        const first = checkMarketData(data)
        const second = checkMarketData(data)
        expect(stable(second)).toEqual(stable(first))
        expect(data).toEqual(before)
        expect(Number.isNaN(Date.parse(first.generated_at))).toBe(false)
      }),
    )
  })

  it('more severe findings never raise the score (score is monotone in findings)', () => {
    // WHY: removing a rule's findings (disabling it) can only keep or raise the score.
    check(
      fc.property(validDataset(), fc.constantFrom(...RULE_IDS), (data, ruleId) => {
        const baseline = checkMarketData(data)
        const without = checkMarketData(data, { rules: { [ruleId]: { enabled: false } } })
        expect(without.sanity_score).toBeGreaterThanOrEqual(baseline.sanity_score)
        // Disabling a rule removes exactly that rule's finding and nothing else.
        expect(without.findings).toEqual(baseline.findings.filter((finding) => finding.rule !== ruleId))
      }),
    )
  })
})

describe('(c) findings are well-formed', () => {
  // WHY: the finding shape is the public report contract. Consumers switch on
  // `rule`, `severity` and `action`, and link `where.date` back to their data.
  it('every finding has a registered rule id, valid severity/action/dimension and a known where.date', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset()), (data) => {
        const report = checkMarketData(data)
        const dates = knownDates(data)
        const seen = new Set<string>()

        for (const finding of report.findings) {
          expect(RULE_IDS.has(finding.rule)).toBe(true)
          expect(finding.severity in SEVERITY_ORDER).toBe(true)
          // The action is the severity's consequence, never independent of it.
          expect(finding.action).toBe(ACTION_FOR_SEVERITY[finding.severity])
          expect(DIMENSIONS).toContain(finding.dimension)
          expect(finding.explanation.length).toBeGreaterThan(0)
          expect(finding.references?.length ?? 0).toBeGreaterThan(0)
          expect(Number.isInteger(finding.occurrences)).toBe(true)
          expect(finding.occurrences).toBeGreaterThanOrEqual(1)
          if (finding.where?.date !== undefined) expect(dates.has(String(finding.where.date))).toBe(true)
          // A rule reports once per dataset.
          expect(seen.has(finding.rule)).toBe(false)
          seen.add(finding.rule)
        }
      }),
    )
  })

  // WHY: the report order is part of the contract (diffable output): severity
  // first, then rule id.
  it('findings are sorted by severity, then rule id', () => {
    check(
      fc.property(fc.oneof(wildDataset, validDataset()), (data) => {
        const findings = runRules(data)
        for (let i = 1; i < findings.length; i += 1) {
          const a = findings[i - 1]!
          const b = findings[i]!
          const order = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule)
          expect(order).toBeLessThanOrEqual(0)
        }
      }),
    )
  })

  // WHY: "not 'check failed' but a causal hypothesis and the evidence". An
  // explanation that prints `undefined`, `NaN` or `[object Object]` on valid
  // input means a template received a value it did not expect.
  it('explanations never leak undefined / NaN / [object Object] on valid input', () => {
    check(
      fc.property(validDataset(), (data) => {
        for (const finding of runRules(data)) {
          expect(finding.explanation).not.toMatch(/undefined|NaN|\[object Object\]/)
        }
      }),
    )
  })
})

describe('(d) clean data is never blocked', () => {
  // WHY: false positives hurt more than false negatives (CONTRIBUTING). A
  // gentle random walk on consecutive weekdays with a currency and no
  // corporate actions contains nothing a rule may call critical (critical =
  // "block this datum"); the score must stay in the "reliable" band as well.
  it('produces no critical findings and no warnings', () => {
    check(
      fc.property(cleanDataset(), (data) => {
        const report = checkMarketData(data)
        expect(report.findings.filter((finding) => finding.severity !== 'info')).toEqual([])
        expect(report.sanity_score).toBeGreaterThanOrEqual(90)
      }),
    )
  })
})
