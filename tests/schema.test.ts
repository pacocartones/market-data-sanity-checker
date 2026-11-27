import { describe, expect, it } from 'vitest'
import { marketDataSetSchema } from '../src/schema/market-data'

const validDataset = {
  symbol: 'AAPL',
  source: 'yahoo',
  currency: 'USD',
  bars: [
    { timestamp: '2024-01-02', open: 185.64, high: 186.05, low: 183.89, close: 185.14, volume: 82488700 },
  ],
}

describe('marketDataSetSchema', () => {
  it.each(['2024-02-30', '2023-02-29', '2024-04-31', '01/02/2024', '2024-01-02T14:30:00', '2024-02-30T09:30:00-0500', '2024-01-02T09:30:00+053'])(
    'rejects an invalid or ambiguous timestamp: %s',
    (timestamp) => {
      const dataset = { ...validDataset, bars: [{ ...validDataset.bars[0], timestamp }] }
      expect(marketDataSetSchema.safeParse(dataset).success).toBe(false)
    },
  )

  it.each(['2024-02-29', '2024-01-02T14:30:00Z', '2024-01-02T14:30:00.123+02:00', '2024-01-02T09:30:00-0500', '2024-01-02T09:30:00+0530'])(
    'accepts a real ISO date or zoned datetime: %s',
    (timestamp) => {
      const dataset = { ...validDataset, bars: [{ ...validDataset.bars[0], timestamp }] }
      expect(marketDataSetSchema.safeParse(dataset).success).toBe(true)
    },
  )

  it('rejects an impossible corporate-action date through the shared timestamp schema', () => {
    const dataset = {
      ...validDataset,
      dividends: [{ exDate: '2024-02-30', amount: 1 }],
      splits: [{ exDate: '2024-04-31', numerator: 2, denominator: 1 }],
    }
    const result = marketDataSetSchema.safeParse(dataset)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
        'dividends.0.exDate',
        'splits.0.exDate',
      ])
    }
  })

  it('accepts a structurally valid dataset', () => {
    const result = marketDataSetSchema.safeParse(validDataset)
    expect(result.success).toBe(true)
  })

  it('rejects a dataset without symbol', () => {
    const { symbol: _symbol, ...withoutSymbol } = validDataset
    expect(marketDataSetSchema.safeParse(withoutSymbol).success).toBe(false)
  })

  it('rejects a dataset without source (provenance is mandatory)', () => {
    const { source: _source, ...withoutSource } = validDataset
    expect(marketDataSetSchema.safeParse(withoutSource).success).toBe(false)
  })

  it('accepts GBX as a currency distinct from GBP', () => {
    expect(marketDataSetSchema.safeParse({ ...validDataset, currency: 'GBX' }).success).toBe(true)
  })

  it('rejects lowercase currency codes', () => {
    expect(marketDataSetSchema.safeParse({ ...validDataset, currency: 'usd' }).success).toBe(false)
  })

  it('accepts structurally valid but implausible prices (plausibility is the rules engine\u2019s job)', () => {
    const implausible = {
      ...validDataset,
      bars: [{ timestamp: '2024-01-02', open: -5, high: 1, low: 10, close: 185.14 }],
    }
    expect(marketDataSetSchema.safeParse(implausible).success).toBe(true)
  })
})
