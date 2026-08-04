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
