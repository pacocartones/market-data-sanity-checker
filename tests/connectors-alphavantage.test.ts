import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { alphaVantage, parseAlphaVantageDaily } from '../src/connectors/alphavantage'
import { ConnectorError, DEFAULT_TIMEOUT_MS } from '../src/connectors/types'
import { marketDataSetSchema } from '../src/schema/market-data'

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/connectors/${name}`, import.meta.url)), 'utf8')

async function ibmDataset() {
  const payload: unknown = JSON.parse(await fixture('alphavantage-daily-ibm.json'))
  return parseAlphaVantageDaily(payload, 'IBM')
}

const ORIGINAL_API_KEY = process.env.ALPHA_VANTAGE_API_KEY
afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.ALPHA_VANTAGE_API_KEY
  else process.env.ALPHA_VANTAGE_API_KEY = ORIGINAL_API_KEY
})

describe('parseAlphaVantageDaily', () => {
  it('parses the fixture into a schema-valid dataset', async () => {
    const dataset = await ibmDataset()
    const parsed = marketDataSetSchema.parse(dataset)
    expect(parsed.symbol).toBe('IBM')
    expect(parsed.source).toBe('alpha-vantage')
    expect(parsed.bars).toHaveLength(12)
    // The endpoint reports no currency/exchange — they stay undefined.
    expect(parsed.currency).toBeUndefined()
    expect(parsed.exchange).toBeUndefined()
  })

  it('sorts bars ascending by date (the API returns them descending)', async () => {
    const dataset = await ibmDataset()
    const timestamps = dataset.bars.map((bar) => bar.timestamp)
    expect(timestamps).toEqual([...timestamps].sort())
    expect(timestamps[0]).toBe('2024-01-02')
    expect(timestamps[11]).toBe('2024-01-18')
  })

  it('parses string values into numbers', async () => {
    const dataset = await ibmDataset()
    const first = dataset.bars[0]!
    expect(first).toMatchObject({ open: 163.1, high: 164.35, low: 161.8, close: 162.5, volume: 4157300 })
    for (const bar of dataset.bars) {
      expect(typeof bar.open).toBe('number')
      expect(typeof bar.close).toBe('number')
      expect(Number.isFinite(bar.close)).toBe(true)
    }
  })

  it('computes adjustmentFactor as adjusted close / close', async () => {
    const dataset = await ibmDataset()
    const beforeDividend = dataset.bars.find((bar) => bar.timestamp === '2024-01-02')!
    expect(beforeDividend.adjustmentFactor).toBeCloseTo(160.83 / 162.5, 10)
    const afterDividend = dataset.bars.find((bar) => bar.timestamp === '2024-01-18')!
    expect(afterDividend.adjustmentFactor).toBeCloseTo(1, 10)
  })

  it('extracts the dividend only from the day with amount > 0', async () => {
    const dataset = await ibmDataset()
    expect(dataset.dividends).toEqual([{ exDate: '2024-01-09', amount: 1.67 }])
  })

  it('extracts the split only from the day with coefficient != 1', async () => {
    const dataset = await ibmDataset()
    expect(dataset.splits).toEqual([{ exDate: '2024-01-16', numerator: 2, denominator: 1 }])
  })

  it('skips entries with a non-finite or non-positive close', () => {
    const payload = {
      'Time Series (Daily)': {
        '2024-01-02': { '1. open': '100.0000', '2. high': '101.0000', '3. low': '99.0000', '4. close': '0.0000' },
        '2024-01-03': { '1. open': '100.0000', '2. high': '101.0000', '3. low': '99.0000', '4. close': 'N/A' },
        '2024-01-04': { '1. open': '100.0000', '2. high': '101.0000', '3. low': '99.0000', '4. close': '100.5000' },
      },
    }
    const dataset = parseAlphaVantageDaily(payload, 'TEST')
    expect(dataset.bars).toHaveLength(1)
    expect(dataset.bars[0]).toMatchObject({ timestamp: '2024-01-04', close: 100.5 })
    // No dividends/splits at all → optional keys stay absent.
    expect(dataset.dividends).toBeUndefined()
    expect(dataset.splits).toBeUndefined()
  })

  it('throws ConnectorError on a rate-limit Note payload', () => {
    const note = 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.'
    expect(() => parseAlphaVantageDaily({ Note: note }, 'IBM')).toThrow(ConnectorError)
    expect(() => parseAlphaVantageDaily({ Note: note }, 'IBM')).toThrow(/25 requests per day/)
  })

  it('throws ConnectorError on an Error Message payload (invalid symbol)', () => {
    const payload = { 'Error Message': 'Invalid API call. Please retry or visit the documentation.' }
    expect(() => parseAlphaVantageDaily(payload, 'NOTASYM')).toThrow(ConnectorError)
    expect(() => parseAlphaVantageDaily(payload, 'NOTASYM')).toThrow(/Invalid API call/)
  })

  it('throws ConnectorError on an Information payload', () => {
    expect(() => parseAlphaVantageDaily({ Information: 'Premium endpoint.' }, 'IBM')).toThrow(ConnectorError)
  })

  it('throws ConnectorError when the time series is missing', () => {
    expect(() => parseAlphaVantageDaily({ 'Meta Data': {} }, 'IBM')).toThrow(ConnectorError)
    expect(() => parseAlphaVantageDaily(undefined, 'IBM')).toThrow(ConnectorError)
  })
})

describe('alphaVantage connector', () => {
  it('exposes the contract metadata', () => {
    expect(alphaVantage.name).toBe('alpha-vantage')
    expect(alphaVantage.requires).toContain('ALPHA_VANTAGE_API_KEY')
  })

  it('available() is false without the env var and true with it', () => {
    delete process.env.ALPHA_VANTAGE_API_KEY
    expect(alphaVantage.available()).toBe(false)
    process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
    expect(alphaVantage.available()).toBe(true)
  })

  it('fetchDaily throws ConnectorError before any network call when the key is missing', async () => {
    delete process.env.ALPHA_VANTAGE_API_KEY
    await expect(alphaVantage.fetchDaily('IBM')).rejects.toThrow(ConnectorError)
    await expect(alphaVantage.fetchDaily('IBM')).rejects.toThrow(/ALPHA_VANTAGE_API_KEY/)
  })
})

describe('alphaVantage.fetchDaily — HTTP concerns (mocked fetch, no network)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Smallest TIME_SERIES_DAILY_ADJUSTED payload parseAlphaVantageDaily accepts. */
  const OK_PAYLOAD = {
    'Time Series (Daily)': {
      '2024-01-02': { '1. open': '100.0', '2. high': '101.0', '3. low': '99.0', '4. close': '100.5' },
    },
  }

  function stubFetch(impl: (url: unknown, init?: RequestInit) => Promise<unknown>) {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('passes an AbortSignal to fetch', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
    const fetchMock = stubFetch(async () => ({ ok: true, status: 200, json: async () => OK_PAYLOAD }))
    const dataset = await alphaVantage.fetchDaily('IBM')

    expect(dataset.bars).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps a timeout rejection to a ConnectorError naming the default timeout', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000)
    stubFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(alphaVantage.fetchDaily('IBM')).rejects.toThrow(ConnectorError)
    await expect(alphaVantage.fetchDaily('IBM')).rejects.toThrow(/timeout after 15000ms/)
  })

  it('honours a custom timeoutMs in the error message', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
    stubFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(alphaVantage.fetchDaily('IBM', { timeoutMs: 250 })).rejects.toThrow(/timeout after 250ms/)
  })

  it('keeps the generic failure message for non-timeout network errors', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
    stubFetch(async () => {
      throw new Error('socket hang up')
    })
    await expect(alphaVantage.fetchDaily('IBM')).rejects.toThrow(/Alpha Vantage request failed for IBM: socket hang up/)
  })
})
