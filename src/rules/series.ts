import type { Bar, Dividend } from '../schema/market-data'

/**
 * Time-series helpers shared by corporate-action rules.
 *
 * Chronology discipline: rules that reason about dates work on a SORTED COPY
 * of the bars (flag, don't delete — the input is never mutated). Whether the
 * original series was ordered is TS_UNORDERED's verdict, not ours; each rule
 * defends its own assumptions.
 */

/**
 * Chronologically sorted copy of the bars (stable; input never mutated).
 *
 * The previous single-comparator version was non-transitive — it compared by
 * index whenever EITHER side was unparseable and by time otherwise — so the
 * result depended on the engine's comparison sequence and could leave
 * parseable bars out of order (2026-07-31 audit).
 *
 * Current semantics, in two passes: bars with a parseable timestamp are
 * sorted by time among themselves (stable: equal times keep input order);
 * bars whose timestamp does not parse cannot be placed chronologically, so
 * they move to the END in their original relative order. Consumers such as
 * `barIndexOnOrBefore` stop at those trailing bars, and `latestClose` may
 * still read them — flag, don't delete: dropping the bars would hide
 * evidence.
 */
export function sortedBars(bars: readonly Bar[]): Bar[] {
  const parseable: Array<{ bar: Bar; index: number; time: number }> = []
  const unparseable: Bar[] = []
  bars.forEach((bar, index) => {
    const time = Date.parse(bar.timestamp)
    if (Number.isNaN(time)) unparseable.push(bar)
    else parseable.push({ bar, index, time })
  })
  // Array.prototype.sort is stable; the index tiebreak makes that explicit.
  parseable.sort((a, b) => a.time - b.time || a.index - b.index)
  return [...parseable.map(({ bar }) => bar), ...unparseable]
}

/**
 * Index of the last bar on or before `isoDate` in a SORTED bar array,
 * or -1 if none exists.
 */
export function barIndexOnOrBefore(sorted: readonly Bar[], isoDate: string): number {
  const target = Date.parse(isoDate)
  if (Number.isNaN(target)) return -1
  let result = -1
  for (let index = 0; index < sorted.length; index += 1) {
    const time = Date.parse(sorted[index]!.timestamp)
    if (Number.isNaN(time) || time > target) break
    result = index
  }
  return result
}

/**
 * Sum of dividend amounts with ex-dates within the trailing `days` before
 * `referenceIso`. `type` filters (e.g. only 'regular'); dividends without a
 * type are always included (absence of a tag is not evidence of special).
 */
export function trailingDividends(
  dividends: readonly Dividend[],
  referenceIso: string,
  days = 365,
  type?: Dividend['type'],
): number {
  const reference = Date.parse(referenceIso)
  if (Number.isNaN(reference)) return 0
  const windowStart = reference - days * 24 * 60 * 60 * 1000
  return dividends
    .filter((dividend) => {
      const exDate = Date.parse(dividend.exDate)
      if (Number.isNaN(exDate) || exDate > reference || exDate < windowStart) return false
      return type === undefined || dividend.type === undefined || dividend.type === type
    })
    .reduce((sum, dividend) => sum + dividend.amount, 0)
}

/** Close of the last bar in a SORTED bar array with a finite, positive close, if any. */
export function latestClose(sorted: readonly Bar[]): number | undefined {
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const close = sorted[index]!.close
    if (Number.isFinite(close) && close > 0) return close
  }
  return undefined
}
