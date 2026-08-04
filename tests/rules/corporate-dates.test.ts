import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { marketDataSetSchema } from '../../src/schema/market-data'
import type { RuleContext } from '../../src/rules/types'
import { exdateAfterPaydate } from '../../src/rules/corporate/exdate-after-paydate'
import { exdateMisplaced } from '../../src/rules/corporate/exdate-misplaced'
import { divNotAdjusted } from '../../src/rules/corporate/div-not-adjusted'

const ctxAfterPaydate: RuleContext = {
  config: { severity: exdateAfterPaydate.meta.severity, params: { ...exdateAfterPaydate.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const ctxMisplaced: RuleContext = {
  config: { severity: exdateMisplaced.meta.severity, params: { ...exdateMisplaced.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

const ctxNotAdjusted: RuleContext = {
  config: { severity: divNotAdjusted.meta.severity, params: { ...divNotAdjusted.meta.defaultParams } },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

async function loadFixture(name: string) {
  const raw = await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
  return marketDataSetSchema.parse(JSON.parse(raw))
}

describe('EXDATE_AFTER_PAYDATE', () => {
  const bars = [
    { timestamp: '2023-05-09', open: 10, high: 10, low: 10, close: 10 },
    { timestamp: '2023-05-10', open: 10, high: 10, low: 10, close: 10 },
  ]

  it('detects a small dividend with the pay date recorded before the ex-date', () => {
    const findings = exdateAfterPaydate.check(
      {
        symbol: 'X',
        source: 'test',
        bars,
        dividends: [{ exDate: '2023-05-10', payDate: '2023-05-05', amount: 0.21 }],
      },
      ctxAfterPaydate,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'EXDATE_AFTER_PAYDATE',
      severity: 'warning',
      action: 'block',
      dimension: 'validity',
      where: { date: '2023-05-10' },
      evidence: { exDate: '2023-05-10', payDate: '2023-05-05' },
    })
    expect(findings[0]!.explanation).toContain('FINRA Rule 11140(b)(2)')
  })

  it('stays silent for a large special dividend (30% of price — FINRA due-bill regime)', () => {
    expect(
      exdateAfterPaydate.check(
        {
          symbol: 'X',
          source: 'test',
          bars,
          dividends: [{ exDate: '2023-05-10', payDate: '2023-05-05', amount: 3, type: 'special' }],
        },
        ctxAfterPaydate,
      ),
    ).toEqual([])
  })

  it('still fires when the dividend size cannot be judged (no usable bars)', () => {
    const findings = exdateAfterPaydate.check(
      {
        symbol: 'X',
        source: 'test',
        bars: [],
        dividends: [{ exDate: '2023-05-10', payDate: '2023-05-05', amount: 0.21 }],
      },
      ctxAfterPaydate,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'EXDATE_AFTER_PAYDATE', severity: 'warning' })
  })

  it('accepts a pay date after the ex-date', () => {
    expect(
      exdateAfterPaydate.check(
        {
          symbol: 'X',
          source: 'test',
          bars: [],
          dividends: [{ exDate: '2023-05-10', payDate: '2023-05-26', amount: 0.21 }],
        },
        ctxAfterPaydate,
      ),
    ).toEqual([])
  })

  it('handles missing pay dates, unparseable dates and absent dividends', () => {
    expect(
      exdateAfterPaydate.check(
        { symbol: 'X', source: 'test', bars: [], dividends: [{ exDate: '2023-05-10', amount: 0.21 }] },
        ctxAfterPaydate,
      ),
    ).toEqual([])
    expect(
      exdateAfterPaydate.check(
        {
          symbol: 'X',
          source: 'test',
          bars: [],
          dividends: [{ exDate: '2023-05-10', payDate: 'not-a-date', amount: 0.21 }],
        },
        ctxAfterPaydate,
      ),
    ).toEqual([])
    expect(exdateAfterPaydate.check({ symbol: 'X', source: 'test', bars: [] }, ctxAfterPaydate)).toEqual([])
  })
})

describe('EXDATE_MISPLACED', () => {
  it('detects the misplaced TETY.ST ex-date (April–May 2023)', async () => {
    const findings = exdateMisplaced.check(await loadFixture('tety-st-misplaced-exdate.json'), ctxMisplaced)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'EXDATE_MISPLACED',
      severity: 'warning',
      where: { date: '2023-04-20' },
      evidence: { expected_drop_pct: 4.19, actual_drop_pct: 0.1, matched_date: '2023-05-04' },
    })
  })

  it('stays silent when the price drops on the registered ex-date', async () => {
    const data = await loadFixture('tety-st-misplaced-exdate.json')
    const droppedOnExdate = {
      ...data,
      bars: data.bars.map((bar) =>
        bar.timestamp === '2023-04-20' ? { ...bar, low: 95.7, close: 95.9 } : bar,
      ),
    }
    expect(exdateMisplaced.check(droppedOnExdate, ctxMisplaced)).toEqual([])
  })

  it('stays silent when no matching drop exists (missing data is not evidence)', async () => {
    const data = await loadFixture('tety-st-misplaced-exdate.json')
    const noDrop = {
      ...data,
      bars: data.bars.map((bar) => {
        if (bar.timestamp === '2023-05-04') return { ...bar, open: 100.2, high: 100.4, low: 99.8, close: 100.1 }
        if (bar.timestamp === '2023-05-05') return { ...bar, open: 100.1, high: 100.3, low: 99.7, close: 100.0 }
        return bar
      }),
    }
    expect(exdateMisplaced.check(noDrop, ctxMisplaced)).toEqual([])
  })

  it('handles datasets without bars, without dividends and with zero amounts', () => {
    expect(
      exdateMisplaced.check(
        { symbol: 'X', source: 'test', bars: [], dividends: [{ exDate: '2023-04-20', amount: 4.2 }] },
        ctxMisplaced,
      ),
    ).toEqual([])
    expect(exdateMisplaced.check({ symbol: 'X', source: 'test', bars: [] }, ctxMisplaced)).toEqual([])
    expect(
      exdateMisplaced.check(
        { symbol: 'X', source: 'test', bars: [], dividends: [{ exDate: '2023-04-20', amount: 0 }] },
        ctxMisplaced,
      ),
    ).toEqual([])
  })
})

describe('DIV_NOT_ADJUSTED', () => {
  it('detects the unadjusted 8TRA.DE dividend (June 2023)', async () => {
    const findings = divNotAdjusted.check(await loadFixture('8tra-de-not-adjusted.json'), ctxNotAdjusted)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule: 'DIV_NOT_ADJUSTED',
      severity: 'warning',
      where: { date: '2023-06-08' },
      evidence: { median_factor_before: 1, dividend_amount: 1.5 },
    })
  })

  it('accepts properly adjusted pre-ex-date prices', async () => {
    const data = await loadFixture('8tra-de-not-adjusted.json')
    const adjusted = {
      ...data,
      bars: data.bars.map((bar) =>
        bar.timestamp < '2023-06-08' ? { ...bar, adjustmentFactor: 0.985 } : bar,
      ),
    }
    expect(divNotAdjusted.check(adjusted, ctxNotAdjusted)).toEqual([])
  })

  it('handles bars without adjustment factors and short pre-ex-date history', async () => {
    const data = await loadFixture('8tra-de-not-adjusted.json')
    const noFactors = { ...data, bars: data.bars.map(({ adjustmentFactor: _unused, ...bar }) => bar) }
    expect(divNotAdjusted.check(noFactors, ctxNotAdjusted)).toEqual([])

    const earlyExdate = { ...data, dividends: [{ exDate: '2023-06-02', amount: 1.5, type: 'regular' as const }] }
    expect(divNotAdjusted.check(earlyExdate, ctxNotAdjusted)).toEqual([])

    expect(divNotAdjusted.check({ symbol: 'X', source: 'test', bars: [] }, ctxNotAdjusted)).toEqual([])
  })
})
