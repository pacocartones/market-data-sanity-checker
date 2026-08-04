import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { divDuplicated } from '../../src/rules/corporate/div-duplicated'

const ctx: RuleContext = {
  config: { severity: divDuplicated.meta.severity, params: { ...divDuplicated.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('DIV_DUPLICATED', () => {
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
