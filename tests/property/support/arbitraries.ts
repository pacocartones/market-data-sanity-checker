import fc from 'fast-check'
import type { Bar, Dividend, MarketDataSet, Split } from '../../../src/schema/market-data'

/**
 * Shared arbitraries (fast-check generators) for the property tests.
 *
 * Three families, from most to least well-behaved:
 *
 * - `cleanDataset`  : a gentle random walk on consecutive weekdays, valid by
 *                     construction. No rule should object (see engine tests).
 * - `validDataset`  : structurally and logically valid bars (ascending distinct
 *                     timestamps, high >= max(open, close), low <= min(open,
 *                     close), positive prices) with random levels, so
 *                     plausibility rules DO fire. Optional volume, adjustment
 *                     factors, dividends, splits, fundamentals, identifiers.
 * - `wildDataset`   : anything the Zod schema accepts (unordered, duplicated,
 *                     zero/negative/extreme prices, odd timestamp formats).
 */

export const DAY_MS = 86_400_000

/** First day used by the generators (a Monday). */
const EPOCH_START = Date.UTC(1995, 0, 2)

/** Drops keys whose value is undefined, so optional fields are truly absent. */
export function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The calendar day `days` after an ISO timestamp (date part only). */
export function dayAfter(timestamp: string, days: number): string {
  return isoDay(Date.parse(timestamp) + days * DAY_MS)
}

/** Linear map of u in [0, 1) onto an integer in [lo, hi]. */
export function pickInt(u: number, lo: number, hi: number): number {
  return lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)))
}

const unit = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true })

/** Three independent draws in [0, 1) that defect injectors map to positions and magnitudes. */
export const draws = fc.record({ a: unit, b: unit, c: unit })
export type Draw = { a: number; b: number; c: number }

const currencies = ['USD', 'EUR', 'GBP', 'GBX', 'JPY', 'CHF'] as const

// ---------------------------------------------------------------------------
// validDataset
// ---------------------------------------------------------------------------

const barShape = fc.record({
  gap: fc.integer({ min: 1, max: 6 }),
  open: fc.double({ min: 0.01, max: 100_000, noNaN: true }),
  closeRel: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
  upRel: fc.double({ min: 0, max: 0.5, noNaN: true }),
  downRel: fc.double({ min: 0, max: 0.5, noNaN: true }),
  volume: fc.option(
    fc.oneof(
      fc.constant(0),
      fc.integer({ min: 1, max: 2_000_000_000 }),
      fc.double({ min: 0, max: 1e12, noNaN: true }),
    ),
    { nil: undefined },
  ),
  factor: fc.option(fc.double({ min: 0.0001, max: 1.5, noNaN: true }), { nil: undefined }),
})

/**
 * Valid OHLCV bars: strictly ascending distinct timestamps, positive prices,
 * high >= max(open, close), low <= min(open, close), volume optional.
 * `intraday` switches the timestamps from calendar days to full UTC datetimes.
 */
export function validBars(
  options: { minBars?: number; maxBars?: number; adjustment?: boolean } = {},
): fc.Arbitrary<Bar[]> {
  const { minBars = 0, maxBars = 40, adjustment = false } = options
  return fc
    .record({
      start: fc.integer({ min: 0, max: 12_000 }),
      intraday: fc.boolean(),
      shapes: fc.array(barShape, { minLength: minBars, maxLength: maxBars }),
    })
    .map(({ start, intraday, shapes }) => {
      let time = EPOCH_START + start * DAY_MS
      return shapes.map((shape): Bar => {
        time += intraday ? shape.gap * 60_000 * 37 : shape.gap * DAY_MS
        const close = shape.open * (1 + shape.closeRel)
        const high = Math.max(shape.open, close) * (1 + shape.upRel)
        const low = Math.min(shape.open, close) * (1 - shape.downRel)
        return defined({
          timestamp: intraday ? new Date(time).toISOString() : isoDay(time),
          open: shape.open,
          high,
          low,
          close,
          volume: shape.volume,
          adjustmentFactor: adjustment ? shape.factor : undefined,
        })
      })
    })
}

const dividendArb = (days: string[]): fc.Arbitrary<Dividend> =>
  fc
    .record({
      idx: fc.nat(),
      offset: fc.integer({ min: -5, max: 5 }),
      payOffset: fc.option(fc.integer({ min: -3, max: 60 }), { nil: undefined }),
      amount: fc.oneof(fc.double({ min: 0.0001, max: 50, noNaN: true }), fc.constant(0)),
      currency: fc.option(fc.constantFrom(...currencies), { nil: undefined }),
      type: fc.option(fc.constantFrom('regular', 'special'), { nil: undefined }),
    })
    .map(({ idx, offset, payOffset, amount, currency, type }) => {
      const base = days.length > 0 ? days[idx % days.length]! : '2020-01-06'
      const exDate = dayAfter(base, offset)
      return defined<Dividend>({
        exDate,
        payDate: payOffset === undefined ? undefined : dayAfter(exDate, payOffset),
        amount,
        currency,
        type,
      })
    })

const splitArb = (days: string[]): fc.Arbitrary<Split> =>
  fc
    .record({
      idx: fc.nat(),
      offset: fc.integer({ min: -5, max: 5 }),
      numerator: fc.integer({ min: 1, max: 30 }),
      denominator: fc.integer({ min: 1, max: 30 }),
    })
    .map(({ idx, offset, numerator, denominator }) => ({
      exDate: dayAfter(days.length > 0 ? days[idx % days.length]! : '2020-01-06', offset),
      numerator,
      denominator,
    }))

const positive = fc.double({ min: 0.001, max: 1e10, noNaN: true })
// Zero or a magnitude in [0.001, 1e10]: no -0 (JSON cannot represent it) and no subnormals
// (halving them underflows, which would break the exact-scaling metamorphic property).
const anyFinite = fc.oneof(positive, positive.map((value) => -value), fc.constant(0))

const fundamentalsArb = fc
  .record(
    {
      marketCap: fc.oneof(positive, anyFinite),
      sharesOutstanding: fc.oneof(positive, anyFinite),
      eps: anyFinite,
      pe: anyFinite,
      dividendYield: fc.oneof(fc.double({ min: 0.001, max: 1, noNaN: true }), fc.constant(0)),
      payoutRatio: fc.oneof(fc.double({ min: 0.001, max: 5, noNaN: true }), fc.double({ min: -1, max: -0.001, noNaN: true }), fc.constant(0)),
    },
    { requiredKeys: [] },
  )

/** A logically valid dataset with random price levels and optional corporate data. */
export function validDataset(options: { minBars?: number; maxBars?: number } = {}): fc.Arbitrary<MarketDataSet> {
  return validBars({ ...options, adjustment: true }).chain((bars) => {
    const days = bars.map((bar) => bar.timestamp.slice(0, 10))
    return fc
      .record({
        symbol: fc.oneof(fc.constantFrom('AAPL', 'VOD.L', 'SAP.DE', '7203.T'), fc.string({ minLength: 1, maxLength: 8 })),
        source: fc.constantFrom('csv', 'yahoo', 'test'),
        exchange: fc.option(fc.constantFrom('NYSE', 'LSE', 'XETRA', 'TSE', 'nasdaq'), { nil: undefined }),
        currency: fc.option(fc.constantFrom(...currencies), { nil: undefined }),
        identifiers: fc.option(
          fc.record({ isin: fc.constantFrom('US0378331005', 'GB0002634946', 'XX0000000000') }),
          { nil: undefined },
        ),
        dividends: fc.option(fc.array(dividendArb(days), { maxLength: 6 }), { nil: undefined }),
        splits: fc.option(fc.array(splitArb(days), { maxLength: 3 }), { nil: undefined }),
        fundamentals: fc.option(fundamentalsArb, { nil: undefined }),
      })
      .map((rest) => defined<MarketDataSet>({ ...rest, bars }))
  })
}

// ---------------------------------------------------------------------------
// cleanDataset
// ---------------------------------------------------------------------------

/**
 * A dataset that is clean BY CONSTRUCTION: consecutive weekdays, a gentle
 * random walk (overnight gap 0.05-0.5 %, session move 0.1-1 % in either direction, wicks of
 * 0.01-0.5 %), strictly positive volume, a currency, no dividends or splits.
 * 30..60 bars by default so every statistical rule has enough history.
 */
export function cleanDataset(options: { minBars?: number; maxBars?: number } = {}): fc.Arbitrary<MarketDataSet> {
  const { minBars = 30, maxBars = 60 } = options
  const step = fc.record({
    // Non-zero magnitudes: a shrunk all-zero walk is a flat series, which STALE_PRICE rightly flags.
    gap: fc.tuple(fc.constantFrom(-1, 1), fc.double({ min: 0.0005, max: 0.005, noNaN: true })).map(([sign, size]) => sign * size),
    move: fc.tuple(fc.constantFrom(-1, 1), fc.double({ min: 0.001, max: 0.01, noNaN: true })).map(([sign, size]) => sign * size),
    up: fc.double({ min: 0.0001, max: 0.005, noNaN: true }),
    down: fc.double({ min: 0.0001, max: 0.005, noNaN: true }),
    volume: fc.integer({ min: 1_000, max: 50_000_000 }),
  })
  return fc
    .record({
      start: fc.integer({ min: 0, max: 2_000 }),
      p0: fc.double({ min: 20, max: 1_000, noNaN: true }),
      steps: fc.array(step, { minLength: minBars, maxLength: maxBars }),
      symbol: fc.constantFrom('CLEAN', 'ACME', 'XYZ'),
    })
    .map(({ start, p0, steps, symbol }) => {
      // Skip to a Monday, then emit consecutive weekdays only.
      let time = EPOCH_START + start * 7 * DAY_MS
      let previousClose = p0
      const bars: Bar[] = steps.map((s) => {
        while ([0, 6].includes(new Date(time).getUTCDay())) time += DAY_MS
        const open = previousClose * (1 + s.gap)
        const close = open * (1 + s.move)
        const bar: Bar = {
          timestamp: isoDay(time),
          open,
          high: Math.max(open, close) * (1 + s.up),
          low: Math.min(open, close) * (1 - s.down),
          close,
          volume: s.volume,
        }
        previousClose = close
        time += DAY_MS
        return bar
      })
      return { symbol, source: 'test', currency: 'USD', bars } satisfies MarketDataSet
    })
}

// ---------------------------------------------------------------------------
// wildDataset
// ---------------------------------------------------------------------------

const wildNumber = fc.oneof(
  { weight: 6, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 4, arbitrary: fc.double({ min: -1000, max: 100_000, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(0, -0, 1, -1, 0.01, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 1e-300, 1e300),
  },
)

/** Any string `Date.parse` accepts, in several shapes (the schema's only timestamp constraint). */
export const wildTimestamp = fc.oneof(
  fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
  fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString()),
  fc.constantFrom('2024-01-02', '2024-01-02T09:30:00-05:00', 'Jan 2, 2024', '2024-02-30', '2024-01-02T25:00:00Z').filter((s) => !Number.isNaN(Date.parse(s))),
)

const wildBar = fc.record(
  {
    timestamp: wildTimestamp,
    open: wildNumber,
    high: wildNumber,
    low: wildNumber,
    close: wildNumber,
    volume: wildNumber,
    adjustmentFactor: fc.double({ min: Number.MIN_VALUE, max: 1e6, noNaN: true }),
  },
  { requiredKeys: ['timestamp', 'open', 'high', 'low', 'close'] },
)

/** Every schema-valid shape, including ones the rules were never designed around. */
export const wildDataset: fc.Arbitrary<MarketDataSet> = fc.record(
  {
    symbol: fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constant('X.L')),
    source: fc.string({ minLength: 1, maxLength: 10 }),
    exchange: fc.string({ maxLength: 8 }),
    currency: fc.constantFrom(...currencies),
    identifiers: fc.record({ isin: fc.string({ maxLength: 14 }), cusip: fc.string(), figi: fc.string() }, { requiredKeys: [] }),
    bars: fc.array(wildBar, { maxLength: 25 }),
    dividends: fc.array(
      fc.record(
        {
          exDate: wildTimestamp,
          payDate: wildTimestamp,
          amount: wildNumber,
          currency: fc.constantFrom(...currencies),
          type: fc.constantFrom('regular', 'special'),
        },
        { requiredKeys: ['exDate', 'amount'] },
      ),
      { maxLength: 6 },
    ),
    splits: fc.array(
      fc.record({
        exDate: wildTimestamp,
        numerator: fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
        denominator: fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
      }),
      { maxLength: 3 },
    ),
    fundamentals: fc.record(
      {
        marketCap: wildNumber,
        sharesOutstanding: wildNumber,
        eps: wildNumber,
        pe: wildNumber,
        dividendYield: wildNumber,
        payoutRatio: wildNumber,
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: ['symbol', 'source', 'bars'] },
) as fc.Arbitrary<MarketDataSet>
