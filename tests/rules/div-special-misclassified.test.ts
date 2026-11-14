import { describe, expect, it, vi } from 'vitest'
import { divSpecialMisclassified } from '../../src/rules/corporate/div-special-misclassified'
import type { RuleContext } from '../../src/rules/types'
import { median } from '../../src/rules/stats'
import type { Dividend } from '../../src/schema/market-data'

const ctx: RuleContext = {
  config: {
    severity: divSpecialMisclassified.meta.severity,
    params: { ...divSpecialMisclassified.meta.defaultParams },
  },
  profile: { returns: [], medianReturn: 0, madReturn: 0 },
}

describe('DIV_SPECIAL_MISCLASSIFIED indexed peers', () => {
  it('checks monthly regular dividends without scanning the entire array per candidate', () => {
    const dividends = Array.from({ length: 64 }, (_, index) => ({
      exDate: new Date(Date.UTC(2020, index, 1)).toISOString().slice(0, 10),
      amount: 1,
      type: 'regular' as const,
    }))
    const filter = vi.spyOn(Array.prototype, 'filter')
    let findings
    let scans
    try {
      findings = divSpecialMisclassified.check({ symbol: 'TEST', source: 'synthetic', bars: [], dividends }, ctx)
      scans = filter.mock.calls.length
    } finally {
      filter.mockRestore()
    }
    expect(findings).toEqual([])
    expect(scans).toBeLessThan(8)
  })

  it('keeps the median and isolated outlier evidence for a normal history', () => {
    const dividends = [
      { exDate: '2023-01-02', amount: 1, type: 'regular' as const },
      { exDate: '2023-04-03', amount: 1, type: 'regular' as const },
      { exDate: '2023-07-03', amount: 1, type: 'regular' as const },
      { exDate: '2023-10-02', amount: 1, type: 'regular' as const },
      { exDate: '2024-02-01', amount: 10, type: 'regular' as const },
    ]
    expect(divSpecialMisclassified.check({ symbol: 'TEST', source: 'synthetic', bars: [], dividends }, ctx))
      .toMatchObject([{ where: { date: '2024-02-01' }, evidence: { amount: 10, peer_median: 1, ratio: 10 } }])
  })

  it('matches the bounded reference for shuffled dates, tied dates, and overrides', () => {
    let seed = 0x87b43
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const dates = ['2020-01-01', '2022-01-01', '2023-03-01', '2023-03-01', '2023-06-01',
      '2024-01-01', '2024-07-01', 'invalid']
    const amounts = [-1, 0, 1, 2, 10, 20]
    const dayMs = 24 * 60 * 60 * 1000
    for (let sample = 0; sample < 200; sample += 1) {
      const dividends: Dividend[] = Array.from({ length: 1 + Math.floor(random() * 12) }, () => ({
        exDate: dates[Math.floor(random() * dates.length)]!,
        amount: amounts[Math.floor(random() * amounts.length)]!,
        type: random() < 0.8 ? 'regular' : 'special',
      }))
      const params = {
        magnitudeRatio: [0, 1, 5, 10][Math.floor(random() * 4)]!,
        isolationDays: [-1, 0, 90, Number.NaN][Math.floor(random() * 4)]!,
        minPeers: [0, 1, 4, Number.NaN][Math.floor(random() * 4)]!,
      }
      const expected = dividends.flatMap((dividend, index) => {
        const time = Date.parse(dividend.exDate)
        if (dividend.type !== 'regular' || !Number.isFinite(dividend.amount) ||
          dividend.amount <= 0 || Number.isNaN(time)) return []
        const peers = dividends.filter((other, otherIndex) => {
          const otherTime = Date.parse(other.exDate)
          return otherIndex !== index && other.type === 'regular' && Number.isFinite(other.amount) &&
            other.amount > 0 && !Number.isNaN(otherTime) && otherTime < time &&
            otherTime >= time - 365 * 3 * dayMs
        })
        if (peers.length < params.minPeers) return []
        const peerMedian = median(peers.map((peer) => peer.amount))
        if (dividend.amount <= params.magnitudeRatio * peerMedian) return []
        if (!dividends.every((other, otherIndex) => otherIndex === index ||
          Number.isNaN(Date.parse(other.exDate)) ||
          Math.abs(Date.parse(other.exDate) - time) > params.isolationDays * dayMs)) return []
        return [{ date: dividend.exDate, amount: dividend.amount,
          peer_median: peerMedian, ratio: dividend.amount / peerMedian }]
      })
      const actual = divSpecialMisclassified.check(
        { symbol: 'TEST', source: 'oracle', bars: [], dividends },
        { ...ctx, config: { ...ctx.config, params } },
      ).map((finding) => ({ date: finding.where?.date, ...finding.evidence }))
      expect(actual, `sample ${sample}`).toEqual(expected)
    }
  })
})
