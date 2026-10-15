import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { runRules } from '../../src/rules/engine'
import type { Bar, MarketDataSet } from '../../src/schema/market-data'
import { cleanDataset, dayAfter, draws, pickInt, type Draw } from './support/arbitraries'
import { check } from './support/config'

/**
 * (f) Defect injection. Start from a dataset that is clean by construction
 * (no finding at all from the rule under test), inject ONE known defect, and
 * require the matching rule to fire.
 *
 * WHY: this is the recall half of the contract. The clean-data property (d)
 * guards against false positives; a rule that never fires would pass every
 * other property, so each pair below pins "defect X is detected by rule Y".
 * Each injector's comment cites the rule semantics it relies on (verified in
 * src/rules/**).
 *
 * To cover another rule: add one entry to DEFECTS (see CONTRIBUTING.md,
 * "Property tests").
 */

interface Injection {
  data: MarketDataSet
  /** Expected `where.date` of the (single-site) finding, when the rule reports one. */
  date?: string
  /** The finding's explanation must match (for rules whose finding has several distinct causes). */
  explanation?: RegExp
  /** Expected severity of the finding, when it is not the rule default. */
  severity?: 'critical' | 'warning' | 'info'
}

interface Defect {
  rule: string
  label: string
  inject(clean: MarketDataSet, draw: Draw): Injection
}

const withBars = (data: MarketDataSet, bars: Bar[]): MarketDataSet => ({ ...data, bars })
const replaceBar = (data: MarketDataSet, index: number, patch: Partial<Bar>): MarketDataSet =>
  withBars(data, data.bars.map((bar, i) => (i === index ? { ...bar, ...patch } : bar)))
const scaleBar = (bar: Bar, k: number): Bar => ({
  ...bar,
  open: bar.open * k,
  high: bar.high * k,
  low: bar.low * k,
  close: bar.close * k,
})
/** Multiplies the prices of every bar from `index` on: a persistent level shift at `index`. */
const shiftLevelFrom = (data: MarketDataSet, index: number, k: number): MarketDataSet =>
  withBars(data, data.bars.map((bar, i) => (i >= index ? scaleBar(bar, k) : bar)))
const ts = (data: MarketDataSet, index: number): string => data.bars[index]!.timestamp
const lerp = (u: number, lo: number, hi: number): number => lo + u * (hi - lo)

/**
 * A quiet series with deterministic, distinct noise (±0.3 %), used where a rule
 * needs a non-degenerate neighbourhood with a known spread (Hampel filter).
 */
function quietSeries(like: MarketDataSet): MarketDataSet {
  const bars = like.bars.map((bar, j): Bar => {
    const close = 100 * (1 + 0.003 * Math.sin(1.7 * j + 0.3))
    return { timestamp: bar.timestamp, open: close, high: close * 1.001, low: close * 0.999, close, volume: 1_000 }
  })
  return withBars(like, bars)
}

const DEFECTS: Defect[] = [
  {
    // OHLC_INCONSISTENT: `high < low` is reported per bar (ohlc-inconsistent.ts).
    rule: 'OHLC_INCONSISTENT',
    label: 'high below low',
    inject(clean, { a, b }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      const bar = clean.bars[i]!
      // The representative finding is the FIRST occurrence, and the high < low check runs first.
      return { data: replaceBar(clean, i, { high: bar.low * lerp(b, 0.5, 0.99) }), date: bar.timestamp, explanation: /^High \(/ }
    },
  },
  {
    // PRICE_NONPOSITIVE: any of open/high/low/close that is not finite and > 0.
    rule: 'PRICE_NONPOSITIVE',
    label: 'zero or negative price field',
    inject(clean, { a, b, c }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      const field = (['open', 'high', 'low', 'close'] as const)[pickInt(b, 0, 3)]!
      const value = c < 0.5 ? 0 : -lerp(c, 0.01, 100)
      return { data: replaceBar(clean, i, { [field]: value }), date: ts(clean, i) }
    },
  },
  {
    // TS_DUPLICATED: two bars whose timestamps parse to the same instant.
    rule: 'TS_DUPLICATED',
    label: 'repeated timestamp',
    inject(clean, { a }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      const bars = [...clean.bars]
      bars.splice(i + 1, 0, { ...clean.bars[i]! })
      return { data: withBars(clean, bars), date: ts(clean, i) }
    },
  },
  {
    // TS_UNORDERED: one adjacent pair swapped (n >= 30, so the series is not "entirely newest-first").
    rule: 'TS_UNORDERED',
    label: 'adjacent bars swapped',
    inject(clean, { a }) {
      const i = pickInt(a, 0, clean.bars.length - 2)
      const bars = [...clean.bars]
      ;[bars[i], bars[i + 1]] = [bars[i + 1]!, bars[i]!]
      return { data: withBars(clean, bars), date: ts(clean, i) }
    },
  },
  {
    // TS_UNORDERED: the whole series delivered newest-first (3+ bars) is one finding at the first bar.
    rule: 'TS_UNORDERED',
    label: 'series reversed (newest first)',
    inject(clean) {
      const bars = [...clean.bars].reverse()
      return { data: withBars(clean, bars), date: bars[0]!.timestamp }
    },
  },
  {
    // VOLUME_NEGATIVE: volume that is negative or not finite.
    rule: 'VOLUME_NEGATIVE',
    label: 'negative volume',
    inject(clean, { a, b }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      return { data: replaceBar(clean, i, { volume: -lerp(b, 1, 1e6) }), date: ts(clean, i) }
    },
  },
  {
    // ZERO_VOLUME_MOVED: volume === 0 while high !== low (clean bars always have high > low).
    rule: 'ZERO_VOLUME_MOVED',
    label: 'zero volume on a bar that moved',
    inject(clean, { a }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      return { data: replaceBar(clean, i, { volume: 0 }), date: ts(clean, i) }
    },
  },
  {
    // STALE_PRICE: >= 3 identical consecutive closes while volume is present; reported at the last bar of the run.
    rule: 'STALE_PRICE',
    label: 'frozen close for 3+ sessions',
    inject(clean, { a, b }) {
      const run = pickInt(b, 3, 6)
      const i = pickInt(a, 0, clean.bars.length - run)
      const price = clean.bars[i]!.close
      const bars = clean.bars.map((bar, j) =>
        j >= i && j < i + run ? { ...bar, open: price, high: price, low: price, close: price, volume: 1_000 } : bar,
      )
      return { data: withBars(clean, bars), date: ts(clean, i + run - 1) }
    },
  },
  {
    // BAR_MISSING: >= 5 weekdays strictly between two consecutive bars (here: 5-8 consecutive bars deleted).
    rule: 'BAR_MISSING',
    label: 'a trading week of bars removed',
    inject(clean, { a, b }) {
      const removed = pickInt(b, 5, 8)
      const i = pickInt(a, 1, clean.bars.length - removed - 1)
      const bars = [...clean.bars.slice(0, i), ...clean.bars.slice(i + removed)]
      return { data: withBars(clean, bars), date: ts(clean, i + removed) }
    },
  },
  {
    // INSUFFICIENT_DATA: fewer than minBars (10) bars -> warning; no bars at all -> escalated to critical.
    rule: 'INSUFFICIENT_DATA',
    label: 'history truncated below 10 bars',
    inject(clean, { a }) {
      const keep = pickInt(a, 1, 9)
      return { data: withBars(clean, clean.bars.slice(0, keep)), severity: 'warning' }
    },
  },
  {
    rule: 'INSUFFICIENT_DATA',
    label: 'no bars at all',
    inject(clean) {
      return { data: withBars(clean, []), severity: 'critical' }
    },
  },
  {
    // RETURN_SPIKE: a persistent +30..90 % level shift is a robust outlier (|modified z| >> 3.5, return >= 4 %).
    // The range excludes the +100 % band of a 1:2 reverse split, which RETURN_SPIKE deliberately defers to
    // SPLIT_NOT_ADJUSTED.
    rule: 'RETURN_SPIKE',
    label: 'one-day +30..90 % jump',
    inject(clean, { a, b }) {
      const i = pickInt(a, 1, clean.bars.length - 1)
      return { data: shiftLevelFrom(clean, i, lerp(b, 1.3, 1.9)), date: ts(clean, i) }
    },
  },
  {
    // SPLIT_NOT_ADJUSTED: a one-session drop matching a common split ratio with no split registered nearby.
    rule: 'SPLIT_NOT_ADJUSTED',
    label: 'prices fall by a 2:1 / 3:1 / 4:1 / 5:1 / 10:1 ratio with no split registered',
    inject(clean, { a, b }) {
      const ratio = [2, 3, 4, 5, 10][pickInt(b, 0, 4)]!
      const i = pickInt(a, 1, clean.bars.length - 1)
      return { data: shiftLevelFrom(clean, i, 1 / ratio), date: ts(clean, i) }
    },
  },
  {
    // PRICE_SPIKE_INTRADAY: an isolated close >= 10 % off a quiet neighbourhood that reverts the next session.
    rule: 'PRICE_SPIKE_INTRADAY',
    label: 'single-bar close spike that reverts',
    inject(clean, { a, b }) {
      const quiet = quietSeries(clean)
      const i = pickInt(a, 1, quiet.bars.length - 2)
      const close = quiet.bars[i]!.close * lerp(b, 1.3, 1.9)
      return { data: replaceBar(quiet, i, { close, high: close }), date: ts(quiet, i) }
    },
  },
  {
    // DIV_DUPLICATED: the same amount twice with ex-dates <= 7 days apart (div-duplicated.ts).
    rule: 'DIV_DUPLICATED',
    label: 'same dividend recorded twice',
    inject(clean, { a, b, c }) {
      const i = pickInt(a, 1, clean.bars.length - 1)
      const amount = lerp(c, 0.01, 0.1)
      const first = ts(clean, i)
      const second = dayAfter(first, pickInt(b, 0, 5))
      return {
        data: { ...clean, dividends: [{ exDate: first, amount }, { exDate: second, amount }] },
        date: second,
      }
    },
  },
  {
    // EXDATE_AFTER_PAYDATE: payDate earlier than exDate, amount far below the 20 % "large special" carve-out.
    rule: 'EXDATE_AFTER_PAYDATE',
    label: 'pay date before ex-date',
    inject(clean, { a, b }) {
      const i = pickInt(a, 1, clean.bars.length - 1)
      const exDate = ts(clean, i)
      return {
        data: { ...clean, dividends: [{ exDate, payDate: dayAfter(exDate, -pickInt(b, 1, 30)), amount: 0.01 }] },
        date: exDate,
      }
    },
  },
  {
    // SPLIT_RATIO_IMPROBABLE: exactly 1:1 ("identity") or >= 20:1 / <= 1:20 ("extreme").
    rule: 'SPLIT_RATIO_IMPROBABLE',
    label: '1:1 or 25:1 split',
    inject(clean, { a, b }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      const split = b < 0.5 ? { numerator: 3, denominator: 3 } : { numerator: 25, denominator: 1 }
      return { data: { ...clean, splits: [{ exDate: ts(clean, i), ...split }] }, date: ts(clean, i) }
    },
  },
  {
    // FUNDAMENTALS_SIGN_VALIDITY: marketCap or sharesOutstanding <= 0.
    rule: 'FUNDAMENTALS_SIGN_VALIDITY',
    label: 'non-positive marketCap / sharesOutstanding',
    inject(clean, { a, b }) {
      const value = a < 0.5 ? 0 : -lerp(b, 1, 1e9)
      const fundamentals = b < 0.5 ? { marketCap: value } : { sharesOutstanding: value }
      return { data: { ...clean, fundamentals }, date: ts(clean, clean.bars.length - 1) }
    },
  },
  {
    // PAYOUT_IMPOSSIBLE: payoutRatio < 0 or > 3.
    rule: 'PAYOUT_IMPOSSIBLE',
    label: 'negative or >300 % payout ratio',
    inject(clean, { a, b }) {
      const payoutRatio = a < 0.5 ? -lerp(b, 0.01, 5) : lerp(b, 3.01, 100)
      return { data: { ...clean, fundamentals: { payoutRatio } }, date: ts(clean, clean.bars.length - 1) }
    },
  },
  {
    // MARKETCAP_MISMATCH: marketCap deviating > 5 % from sharesOutstanding x latest close (here 2x-5x too big).
    rule: 'MARKETCAP_MISMATCH',
    label: 'marketCap inconsistent with shares x close',
    inject(clean, { a, b }) {
      const shares = lerp(a, 1e6, 1e9)
      const close = clean.bars[clean.bars.length - 1]!.close
      const marketCap = shares * close * lerp(b, 2, 5)
      return { data: { ...clean, fundamentals: { marketCap, sharesOutstanding: shares } }, date: ts(clean, clean.bars.length - 1) }
    },
  },
  {
    // PE_EPS_INCOMPATIBLE: a negative P/E with positive EPS (sign contradiction).
    rule: 'PE_EPS_INCOMPATIBLE',
    label: 'negative P/E with positive EPS',
    inject(clean, { a, b }) {
      return {
        data: { ...clean, fundamentals: { eps: lerp(a, 0.1, 20), pe: -lerp(b, 1, 50) } },
        date: ts(clean, clean.bars.length - 1),
      }
    },
  },
  {
    // DIVIDEND_FX_MISMATCH: a dividend currency different from the series currency (clean data is USD).
    rule: 'DIVIDEND_FX_MISMATCH',
    label: 'dividend quoted in another currency',
    inject(clean, { a, b }) {
      const i = pickInt(a, 0, clean.bars.length - 1)
      const currency = ['EUR', 'GBP', 'JPY'][pickInt(b, 0, 2)]!
      return { data: { ...clean, dividends: [{ exDate: ts(clean, i), amount: 0.05, currency }] }, date: ts(clean, i) }
    },
  },
  {
    // CURRENCY_SUSPECT (info): the dataset carries no currency at all (reported without a date).
    rule: 'CURRENCY_SUSPECT',
    label: 'currency missing',
    inject(clean) {
      const { currency: _currency, ...rest } = clean
      return { data: rest, severity: 'info' }
    },
  },
  {
    // CURRENCY_SUSPECT (warning): a ".L" series labelled GBP whose median close is > 500 looks like pence.
    rule: 'CURRENCY_SUSPECT',
    label: 'GBP-labelled .L series with pence-sized prices',
    inject(clean) {
      // Clean closes stay within ~[0.5, 2] x the first close (at most 60 steps of <= 1 %): rescale so every close is > 500.
      const k = 1_500 / clean.bars[0]!.close
      const scaled = withBars(clean, clean.bars.map((bar) => scaleBar(bar, k)))
      return { data: { ...scaled, symbol: 'VOD.L', currency: 'GBP' }, date: ts(clean, clean.bars.length - 1), severity: 'warning' }
    },
  },
]

const injectionArbitrary = fc.record({ clean: cleanDataset(), draw: draws })

describe('(f) injecting a known defect makes the matching rule fire', () => {
  it.each(DEFECTS)('$rule: $label', (defect) => {
    check(
      fc.property(injectionArbitrary, ({ clean, draw }) => {
        // Precondition: the clean dataset does not trigger the rule, so the defect is the cause.
        expect(runRules(clean).map((finding) => finding.rule)).not.toContain(defect.rule)

        const injection = defect.inject(clean, draw)
        const finding = runRules(injection.data).find((candidate) => candidate.rule === defect.rule)
        expect(finding, `${defect.rule} did not fire`).toBeDefined()
        if (injection.date !== undefined) expect(finding!.where?.date).toBe(injection.date)
        if (injection.explanation !== undefined) expect(finding!.explanation).toMatch(injection.explanation)
        if (injection.severity !== undefined) expect(finding!.severity).toBe(injection.severity)
      }),
    )
  })

  it('covers at least five distinct rules', () => {
    expect(new Set(DEFECTS.map((defect) => defect.rule)).size).toBeGreaterThanOrEqual(5)
  })
})

describe('(f) controls: removing the defect removes the finding', () => {
  // WHY: SPLIT_NOT_ADJUSTED fires only when NO split is registered near the jump
  // (splitWindowDays = 3). Registering the split that explains the jump must
  // silence it, and RETURN_SPIKE must defer to it for split-shaped moves.
  it('a registered split at the jump date explains it away', () => {
    check(
      fc.property(injectionArbitrary, ({ clean, draw }) => {
        const ratio = [2, 3, 4, 5, 10][pickInt(draw.b, 0, 4)]!
        const i = pickInt(draw.a, 1, clean.bars.length - 1)
        const jumped = shiftLevelFrom(clean, i, 1 / ratio)
        const split = { exDate: ts(clean, i), numerator: ratio, denominator: 1 }
        const rules = runRules({ ...jumped, splits: [split] }).map((finding) => finding.rule)
        expect(rules).not.toContain('SPLIT_NOT_ADJUSTED')
        expect(rules).not.toContain('RETURN_SPIKE')
      }),
    )
  })

  // WHY: TS_DUPLICATED collapses to one finding per duplicated timestamp, and the
  // rule is silent on the same dataset before the duplicate row is added.
  it('one repeated row gives exactly one occurrence, and none before it was added', () => {
    check(
      fc.property(injectionArbitrary, ({ clean, draw }) => {
        const i = pickInt(draw.a, 0, clean.bars.length - 1)
        const bars = [...clean.bars]
        bars.splice(i + 1, 0, { ...clean.bars[i]! })
        const duplicated = runRules(withBars(clean, bars)).find((finding) => finding.rule === 'TS_DUPLICATED')
        expect(duplicated?.occurrences).toBe(1)
        expect(runRules(clean).map((finding) => finding.rule)).not.toContain('TS_DUPLICATED')
      }),
    )
  })
})
