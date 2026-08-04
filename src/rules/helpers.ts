/**
 * Shared helpers for corporate-action-aware price rules.
 */

/**
 * Common split ratios and the one-session price return they imply when the
 * series has NOT been adjusted (a 2:1 split shows as a −50% "crash").
 * Reverse splits included: a 1:5 reverse split shows as +400%.
 */
export const SPLIT_RATIO_RETURNS: ReadonlyArray<{ ratio: string; impliedReturn: number }> = [
  { ratio: '2:1', impliedReturn: -0.5 },
  { ratio: '3:1', impliedReturn: -2 / 3 },
  { ratio: '3:2', impliedReturn: -1 / 3 },
  { ratio: '4:1', impliedReturn: -0.75 },
  { ratio: '5:1', impliedReturn: -0.8 },
  { ratio: '7:1', impliedReturn: -6 / 7 },
  { ratio: '10:1', impliedReturn: -0.9 },
  { ratio: '20:1', impliedReturn: -0.95 },
  { ratio: '1:2 (reverse)', impliedReturn: 1 },
  { ratio: '1:5 (reverse)', impliedReturn: 4 },
  { ratio: '1:8 (reverse)', impliedReturn: 7 },
  { ratio: '1:10 (reverse)', impliedReturn: 9 },
  { ratio: '1:20 (reverse)', impliedReturn: 19 },
]

/**
 * If `actualReturn` matches the return implied by a common split ratio,
 * returns that ratio label; otherwise undefined.
 *
 * Contract (changed 2026-07-31, audit wave 1): `tolerance` is RELATIVE to the
 * split-implied return — a match requires
 * `|actualReturn − impliedReturn| ≤ tolerance × |impliedReturn|`.
 * Split days carry elevated volatility, so the previous absolute band
 * silently disabled the match on real data: a 2:1 split landing on a −5% day
 * shows −52.5% (outside the old ±2pp), and a 1:10 reverse on a +2% day shows
 * +920% (outside any fixed band around +900%). A relative band scales with
 * the jump: 0.05 accepts −47.5%…−52.5% for a 2:1 and +855%…+945% for a 1:10.
 *
 * The `(1 + 1e-9)` slack absorbs binary floating-point error at the band edge
 * (47.5/100 − 1 evaluates 2e-17 outside the exact 2:1 band) without changing
 * the economics of the match.
 */
export function matchSplitRatio(actualReturn: number, tolerance: number): string | undefined {
  return SPLIT_RATIO_RETURNS.find(
    ({ impliedReturn }) =>
      Math.abs(actualReturn - impliedReturn) <= tolerance * Math.abs(impliedReturn) * (1 + 1e-9),
  )?.ratio
}
