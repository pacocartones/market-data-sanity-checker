import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { splitRatioImprobable } from '../../src/rules/corporate/split-ratio-improbable'

const ctx: RuleContext = {
  config: {
    severity: splitRatioImprobable.meta.severity,
    params: { ...splitRatioImprobable.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('SPLIT_RATIO_IMPROBABLE', () => {
  it("accepts GE's legitimate 1-for-8 reverse split (Aug 2021)", async () => {
    expect(splitRatioImprobable.check(await loadFixture('ge-reverse-split.json'), ctx)).toEqual([])
  })

  it('flags a 1-for-20 reverse split as extreme (GEVO signature)', async () => {
    const data = await loadFixture('ge-reverse-split.json')
    const gevo = { ...data, splits: [{ exDate: '2018-06-04', numerator: 1, denominator: 20 }] }
    const findings = splitRatioImprobable.check(gevo, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SPLIT_RATIO_IMPROBABLE',
      severity: 'warning',
      where: { date: '2018-06-04' },
      evidence: { numerator: 1, denominator: 20, ratio: 0.05, reason: 'extreme' },
    })
  })

  it('flags an exactly 1:1 split as identity', async () => {
    const data = await loadFixture('ge-reverse-split.json')
    const noOp = { ...data, splits: [{ exDate: '2024-03-01', numerator: 1, denominator: 1 }] }
    const findings = splitRatioImprobable.check(noOp, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SPLIT_RATIO_IMPROBABLE',
      severity: 'warning',
      where: { date: '2024-03-01' },
      evidence: { numerator: 1, denominator: 1, ratio: 1, reason: 'identity' },
    })
  })

  it('degrades a 21:20 split to info (near_one is the spin-off signature)', async () => {
    const data = await loadFixture('ge-reverse-split.json')
    const typo = { ...data, splits: [{ exDate: '2024-03-01', numerator: 21, denominator: 20 }] }
    const findings = splitRatioImprobable.check(typo, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SPLIT_RATIO_IMPROBABLE',
      severity: 'info',
      where: { date: '2024-03-01' },
      evidence: { numerator: 21, denominator: 20, ratio: 1.05, reason: 'near_one' },
    })
    expect(findings[0]!.explanation).toContain('spin-off')
  })

  it("degrades HON's 1907:2000 spin-off (Yahoo fractional-split encoding) to info", async () => {
    const data = await loadFixture('ge-reverse-split.json')
    const hon = { ...data, splits: [{ exDate: '2024-03-01', numerator: 1907, denominator: 2000 }] }
    const findings = splitRatioImprobable.check(hon, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SPLIT_RATIO_IMPROBABLE',
      severity: 'info',
      where: { date: '2024-03-01' },
      evidence: { numerator: 1907, denominator: 2000, reason: 'near_one' },
    })
    expect(findings[0]!.explanation).toContain('spin-off')
  })

  it('flags a 20:1 split as extreme but cites the real AMZN/GOOGL precedents', async () => {
    const data = await loadFixture('ge-reverse-split.json')
    const amzn = { ...data, splits: [{ exDate: '2022-06-06', numerator: 20, denominator: 1 }] }
    const findings = splitRatioImprobable.check(amzn, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'SPLIT_RATIO_IMPROBABLE',
      severity: 'warning',
      where: { date: '2022-06-06' },
      evidence: { numerator: 20, denominator: 1, ratio: 20, reason: 'extreme' },
    })
    expect(findings[0]!.explanation).toContain('AMZN')
    expect(findings[0]!.explanation).toContain('GOOGL')
  })

  it('returns [] when the dataset has no splits', () => {
    expect(splitRatioImprobable.check({ symbol: 'X', source: 'test', bars: [] }, ctx)).toEqual([])
  })

  it('is total on structurally impossible splits (zero denominator, NaN, negative)', () => {
    const broken = {
      symbol: 'X',
      source: 'test',
      bars: [],
      splits: [
        { exDate: '2024-01-02', numerator: 1, denominator: 0 },
        { exDate: '2024-01-03', numerator: Number.NaN, denominator: 2 },
        { exDate: '2024-01-04', numerator: -2, denominator: 1 },
      ],
    }
    expect(splitRatioImprobable.check(broken, ctx)).toEqual([])
  })
})
