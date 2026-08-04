import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorError, DEFAULT_TIMEOUT_MS } from '../src/connectors/types'
import { parseYahooChart, yahoo } from '../src/connectors/yahoo'
import { marketDataSetSchema } from '../src/schema/market-data'

/** Structural view of the recorded chart API v8 fixtures (no `any`). */
interface YahooChartFixture {
  chart: {
    result: Array<{
      meta: { currency?: string; symbol?: string; exchangeName?: string; gmtoffset?: number }
      timestamp: number[]
      indicators: {
        quote: Array<{
          open: Array<number | null>
          high: Array<number | null>
          low: Array<number | null>
          close: Array<number | null>
          volume: Array<number | null>
        }>
        adjclose?: Array<{ adjclose: Array<number | null> }>
      }
      events?: unknown
    }>
  }
}

const fixture = async (name: string): Promise<YahooChartFixture> =>
  JSON.parse(
    await readFile(fileURLToPath(new URL(`./fixtures/connectors/${name}`, import.meta.url)), 'utf8'),
  ) as YahooChartFixture

/** Minimal synthetic chart payload builder for the edge cases the fixtures lack. */
function chartPayload(overrides: {
  timestamps: number[]
  quote: { open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }
  gmtoffset?: number
  adjclose?: unknown[]
  events?: unknown
}): unknown {
  return {
    chart: {
      result: [
        {
          meta: { currency: 'USD', symbol: 'SYN', exchangeName: 'NMS', gmtoffset: overrides.gmtoffset ?? 0 },
          timestamp: overrides.timestamps,
          indicators: {
            quote: [overrides.quote],
            ...(overrides.adjclose ? { adjclose: [{ adjclose: overrides.adjclose }] } : {}),
          },
          ...(overrides.events !== undefined ? { events: overrides.events } : {}),
        },
      ],
    },
  }
}

describe('yahoo connector contract', () => {
  it('is keyless and always available', () => {
    expect(yahoo.name).toBe('yahoo')
    expect(yahoo.requires).toBe('nothing (keyless)')
    expect(yahoo.available()).toBe(true)
  })
})

describe('yahoo.fetchDaily — HTTP concerns (mocked fetch, no network)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Smallest chart payload parseYahooChart accepts. */
  const OK_PAYLOAD = {
    chart: {
      result: [
        {
          meta: { symbol: 'AAPL', gmtoffset: 0 },
          timestamp: [1704153600],
          indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1] }] },
        },
      ],
    },
  }

  function stubFetchResolving(payload: unknown) {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function stubFetchRejecting(error: unknown) {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
      throw error
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('passes an AbortSignal and the User-Agent header to fetch', async () => {
    const fetchMock = stubFetchResolving(OK_PAYLOAD)
    const dataset = await yahoo.fetchDaily('AAPL')

    expect(dataset.bars).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect((init?.headers as Record<string, string>)['User-Agent']).toContain('market-data-sanity-checker')
  })

  it('maps a timeout rejection to a ConnectorError naming the default timeout', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000)
    stubFetchRejecting(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(yahoo.fetchDaily('AAPL')).rejects.toThrow(ConnectorError)
    await expect(yahoo.fetchDaily('AAPL')).rejects.toThrow(/timeout after 15000ms/)
  })

  it('honours a custom timeoutMs in the error message', async () => {
    stubFetchRejecting(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(yahoo.fetchDaily('AAPL', { timeoutMs: 250 })).rejects.toThrow(/timeout after 250ms/)
  })

  it('keeps the generic failure message for non-timeout network errors', async () => {
    stubFetchRejecting(new Error('socket hang up'))
    await expect(yahoo.fetchDaily('AAPL')).rejects.toThrow(/Yahoo chart request failed for 'AAPL': socket hang up/)
  })
})

describe('parseYahooChart — AAPL fixture (real recorded payload)', () => {
  it('parses meta and every bar with finite OHLC and YYYY-MM-DD timestamps', async () => {
    const raw = await fixture('yahoo-chart-aapl.json')
    const dataset = parseYahooChart(raw, 'AAPL')

    expect(dataset.symbol).toBe('AAPL')
    expect(dataset.exchange).toBe('NMS')
    expect(dataset.currency).toBe('USD')
    expect(dataset.source).toBe('yahoo')
    expect(dataset.bars).toHaveLength(22)
    for (const bar of dataset.bars) {
      expect(bar.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      for (const price of [bar.open, bar.high, bar.low, bar.close]) {
        expect(Number.isFinite(price)).toBe(true)
      }
    }
    // The whole dataset must pass canonical schema validation.
    expect(marketDataSetSchema.safeParse(dataset).success).toBe(true)
  })

  it('keeps the raw closes and derives adjustmentFactor as adjclose/close', async () => {
    const raw = await fixture('yahoo-chart-aapl.json')
    const result = raw.chart.result[0]!
    const quote = result.indicators.quote[0]!
    const adjclose = result.indicators.adjclose![0]!.adjclose
    const dataset = parseYahooChart(raw, 'AAPL')

    const first = dataset.bars[0]!
    expect(first.timestamp).toBe('2026-07-01')
    expect(first.close).toBe(294.3800048828125) // read straight from the fixture
    expect(first.open).toBe(quote.open[0])
    expect(first.volume).toBe(50164200)

    // Per bar: factor present exactly when the payload has adjclose for it.
    dataset.bars.forEach((bar, index) => {
      const adj = adjclose[index]
      const close = quote.close[index]
      if (typeof adj === 'number' && typeof close === 'number' && adj > 0 && close > 0) {
        expect(bar.adjustmentFactor).toBe(adj / close)
      } else {
        expect(bar.adjustmentFactor).toBeUndefined()
      }
    })
  })

  it('returns no dividends/splits arrays when the payload has no events', async () => {
    const raw = await fixture('yahoo-chart-aapl.json')
    expect(raw.chart.result[0]!.events).toBeUndefined()
    const dataset = parseYahooChart(raw, 'AAPL')
    expect(dataset.dividends).toBeUndefined()
    expect(dataset.splits).toBeUndefined()
  })
})

describe('parseYahooChart — MOB.ST fixture (European exchange, gmtoffset +7200)', () => {
  it('derives every bar date with the exchange gmtoffset, not plain UTC', async () => {
    const raw = await fixture('yahoo-chart-mob-st.json')
    const result = raw.chart.result[0]!
    const gmtOffset = result.meta.gmtoffset!
    expect(gmtOffset).toBe(7200)
    const dataset = parseYahooChart(raw, 'MOB.ST')

    expect(dataset.symbol).toBe('MOB.ST')
    expect(dataset.exchange).toBe('STO')
    expect(dataset.currency).toBe('SEK')
    expect(dataset.bars).toHaveLength(result.timestamp.length)
    result.timestamp.forEach((ts, index) => {
      const expected = new Date((ts + gmtOffset) * 1000).toISOString().slice(0, 10)
      expect(dataset.bars[index]!.timestamp).toBe(expected)
    })
    expect(dataset.bars[0]!.timestamp).toBe('2026-06-30')
    expect(dataset.bars.at(-1)!.timestamp).toBe('2026-07-31')
    expect(marketDataSetSchema.safeParse(dataset).success).toBe(true)
  })

  it('uses the requested symbol when meta omits it', () => {
    const payload = chartPayload({
      timestamps: [1704067200],
      quote: { open: [1], high: [1], low: [1], close: [1] },
    })
    const withMeta = parseYahooChart(payload, 'FALLBACK')
    expect(withMeta.symbol).toBe('SYN') // meta wins when present
    const noMeta = { chart: { result: [{ meta: {}, timestamp: [1704067200], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1] }] } }] } }
    expect(parseYahooChart(noMeta, 'FALLBACK').symbol).toBe('FALLBACK')
  })
})

describe('parseYahooChart — date conversion across midnight', () => {
  it('shifts the calendar day when the offset crosses UTC midnight', () => {
    // 2024-01-01 23:30:00 UTC is already 2024-01-02 01:30 in a +02:00 exchange.
    const ts = 1704151800
    expect(new Date(ts * 1000).toISOString().slice(0, 10)).toBe('2024-01-01')
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [ts],
        quote: { open: [10], high: [11], low: [9], close: [10.5] },
        gmtoffset: 7200,
      }),
      'SYN',
    )
    expect(dataset.bars[0]!.timestamp).toBe('2024-01-02')
  })

  it('falls back to gmtoffset 0 when meta omits it', () => {
    const payload = {
      chart: {
        result: [
          { meta: { symbol: 'SYN' }, timestamp: [1704151800], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1] }] } },
        ],
      },
    }
    expect(parseYahooChart(payload, 'SYN').bars[0]!.timestamp).toBe('2024-01-01')
  })
})

describe('parseYahooChart — nulls and gaps', () => {
  it('skips bars with non-finite OHLC and omits null volume instead of zero-filling', () => {
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [1704067200, 1704153600, 1704240000],
        quote: {
          open: [100, null, 102],
          high: [101, 103, 103],
          low: [99, 99, 101],
          close: [100.5, 102.5, null],
          volume: [1_000_000, null, 2_000_000],
        },
      }),
      'SYN',
    )
    // Bar 2 (null open) and bar 3 (null close) are skipped.
    expect(dataset.bars).toHaveLength(1)
    expect(dataset.bars[0]!.timestamp).toBe('2024-01-01')
    expect(dataset.bars[0]!.volume).toBe(1_000_000)
  })

  it('omits the volume field when Yahoo reports null volume for an otherwise valid bar', () => {
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [1704067200],
        quote: { open: [100], high: [101], low: [99], close: [100.5], volume: [null] },
      }),
      'SYN',
    )
    expect(dataset.bars).toHaveLength(1)
    expect(dataset.bars[0]).not.toHaveProperty('volume')
  })

  it('derives adjustmentFactor only when adjclose and close are finite and positive', () => {
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [1704067200, 1704153600, 1704240000],
        quote: { open: [100, 100, 100], high: [101, 101, 101], low: [99, 99, 99], close: [100, 100, 100] },
        adjclose: [95, null, 0],
      }),
      'SYN',
    )
    expect(dataset.bars[0]!.adjustmentFactor).toBe(0.95)
    expect(dataset.bars[1]!.adjustmentFactor).toBeUndefined()
    expect(dataset.bars[2]!.adjustmentFactor).toBeUndefined()
  })
})

describe('parseYahooChart — events', () => {
  it('maps dividends and splits to exchange-local exDates, chronologically sorted', () => {
    const dividendTs = 1704240000 // 2024-01-03 00:00 UTC
    const splitTs = 1704153600 // 2024-01-02 00:00 UTC
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [1704067200],
        quote: { open: [100], high: [101], low: [99], close: [100.5] },
        events: {
          dividends: { [String(dividendTs)]: { date: dividendTs, amount: 0.24 } },
          splits: { [String(splitTs)]: { date: splitTs, numerator: 4, denominator: 1 } },
        },
      }),
      'SYN',
    )
    expect(dataset.dividends).toEqual([{ exDate: '2024-01-03', amount: 0.24 }])
    expect(dataset.splits).toEqual([{ exDate: '2024-01-02', numerator: 4, denominator: 1 }])
  })

  it('skips malformed event entries instead of throwing', () => {
    const dataset = parseYahooChart(
      chartPayload({
        timestamps: [1704067200],
        quote: { open: [100], high: [101], low: [99], close: [100.5] },
        events: {
          dividends: { a: { date: 1704240000, amount: 0.24 }, b: { date: null, amount: 0.5 }, c: 'garbage' },
        },
      }),
      'SYN',
    )
    expect(dataset.dividends).toEqual([{ exDate: '2024-01-03', amount: 0.24 }])
  })
})

describe('parseYahooChart — error paths', () => {
  it('throws ConnectorError when chart.error is present (symbol not found)', () => {
    const payload = {
      chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } },
    }
    expect(() => parseYahooChart(payload, 'NEXISTE')).toThrow(ConnectorError)
    expect(() => parseYahooChart(payload, 'NEXISTE')).toThrow(/NEXISTE.*Not Found/i)
  })

  it('throws ConnectorError when result is missing or empty', () => {
    expect(() => parseYahooChart({ chart: { result: [] } }, 'EMPTY')).toThrow(ConnectorError)
    expect(() => parseYahooChart({ chart: { result: [] } }, 'EMPTY')).toThrow(/no data/i)
    expect(() => parseYahooChart({ chart: {} }, 'NORESULT')).toThrow(ConnectorError)
  })

  it('throws ConnectorError on malformed payloads', () => {
    expect(() => parseYahooChart(null, 'NULL')).toThrow(ConnectorError)
    expect(() => parseYahooChart('not json', 'STR')).toThrow(ConnectorError)
    expect(() => parseYahooChart({ chart: { result: [null] } }, 'BADENTRY')).toThrow(ConnectorError)
    // Result without the timestamp/quote essentials is malformed, not empty data.
    expect(() => parseYahooChart({ chart: { result: [{ meta: {} }] } }, 'NOTS')).toThrow(ConnectorError)
    expect(() => parseYahooChart({ chart: { result: [{ meta: {}, timestamp: [1704067200] }] } }, 'NOQUOTE')).toThrow(
      ConnectorError,
    )
  })
})
