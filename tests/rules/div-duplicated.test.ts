import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { divDuplicated } from '../../src/rules/corporate/div-duplicated'
import { runRules } from '../../src/rules/engine'
import { registry } from '../../src/rules/registry'

const ctx: RuleContext = {
  config: { severity: divDuplicated.meta.severity, params: { ...divDuplicated.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('DIV_DUPLICATED', () => {
  it('keeps the public pair array while the report counts all six pairs', () => {
    const data = {
      symbol: 'TEST', source: 'synthetic', bars: [],
      dividends: Array.from({ length: 4 }, () => ({ exDate: '2024-01-02', amount: 0.25 })),
    }
    const direct = divDuplicated.check(data, ctx)
    expect(direct).toHaveLength(6)
    expect(direct[0]).toMatchObject({
      where: { date: '2024-01-02' },
      evidence: { first_exDate: '2024-01-02', duplicate_exDate: '2024-01-02' },
    })
    expect(runRules(data).find((item) => item.rule === 'DIV_DUPLICATED')).toMatchObject({
      occurrences: 6, severity: 'warning', action: 'flag',
      where: direct[0]!.where, evidence: direct[0]!.evidence,
    })
  })

  it('counts duplicate pairs in the report without parsing every pair', () => {
    const data = {
      symbol: 'TEST', source: 'synthetic', bars: [],
      dividends: Array.from({ length: 64 }, () => ({ exDate: '2024-01-02', amount: 0.25 })),
    }
    const rules = Object.fromEntries(registry.filter((rule) => rule.meta.id !== 'DIV_DUPLICATED')
      .map((rule) => [rule.meta.id, { enabled: false }]))
    const parse = vi.spyOn(Date, 'parse')
    try {
      const finding = runRules(data, { rules }).find((item) => item.rule === 'DIV_DUPLICATED')
      expect(finding).toMatchObject({ occurrences: 2016, where: { date: '2024-01-02' } })
      expect(parse.mock.calls.length).toBeLessThan(512)
    } finally {
      parse.mockRestore()
    }
  })

  it('matches the public pair oracle for bounded varied inputs and overrides', () => {
    let seed = 0x528e1
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const amounts = [-Number.MAX_VALUE, -2, -1, -0, 0, 1, 2, Number.MAX_VALUE]
    const dates = ['2024-01-01', '2024-01-03', '2024-01-08', '2024-02-01', 'bad-date']
    const tolerances = [-1, 0, 0.001, 0.5, 1, 2, Number.POSITIVE_INFINITY, Number.NaN]
    const windows = [-1, 0, 2, 7, 100, Number.NaN]
    const rules = Object.fromEntries(registry.filter((rule) => rule.meta.id !== 'DIV_DUPLICATED')
      .map((rule) => [rule.meta.id, { enabled: false }]))

    for (let sample = 0; sample < 300; sample += 1) {
      const dividends = Array.from({ length: 2 + Math.floor(random() * 8) }, () => ({
        exDate: dates[Math.floor(random() * dates.length)]!,
        amount: amounts[Math.floor(random() * amounts.length)]!,
      }))
      const params = {
        windowDays: windows[Math.floor(random() * windows.length)]!,
        amountTolerancePct: tolerances[Math.floor(random() * tolerances.length)]!,
      }
      const data = { symbol: 'TEST', source: 'oracle', bars: [], dividends }
      const direct = divDuplicated.check(data, { ...ctx, config: { ...ctx.config, params } })
      const report = runRules(data, { rules: { ...rules, DIV_DUPLICATED: { params } } })
      const summary = report.find((item) => item.rule === 'DIV_DUPLICATED')
      expect(summary?.occurrences ?? 0, `sample ${sample}`).toBe(direct.length)
      if (direct.length > 0) {
        expect(summary, `sample ${sample}`).toMatchObject({
          where: direct[0]!.where,
          evidence: direct[0]!.evidence,
          explanation: direct[0]!.explanation,
        })
      }
    }
  })

  it('detects the duplicated ALC.SW dividend (May 2023)', async () => {
    const findings = divDuplicated.check(await loadFixture('alc-sw-duplicated-dividend.json'), ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_DUPLICATED',
      severity: 'warning',
      where: { date: '2023-05-10' },
      evidence: { amount: 0.21, first_exDate: '2023-05-09', duplicate_exDate: '2023-05-10' },
    })
  })

  it('ignores distinct payments beyond the window', async () => {
    const data = await loadFixture('alc-sw-duplicated-dividend.json')
    const quarterly = {
      ...data,
      dividends: [
        { exDate: '2023-03-10', amount: 0.21 },
        { exDate: '2023-06-09', amount: 0.21 },
      ],
    }
    expect(divDuplicated.check(quarterly, ctx)).toEqual([])
  })

  it('ignores different amounts inside the window', async () => {
    const data = await loadFixture('alc-sw-duplicated-dividend.json')
    const interim = {
      ...data,
      dividends: [
        { exDate: '2023-05-09', amount: 0.21 },
        { exDate: '2023-05-10', amount: 0.5 },
      ],
    }
    expect(divDuplicated.check(interim, ctx)).toEqual([])
  })

  it('handles datasets without dividends', () => {
    expect(
      divDuplicated.check({ symbol: 'X', source: 'test', bars: [] }, ctx),
    ).toEqual([])
  })
})
