/**
 * Statistics toolbox for the rules engine. Pure, dependency-free, and
 * conservative by design — robust estimators (median, MAD) that survive the
 * very outliers we are trying to detect.
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const lower = sorted[mid - 1]
  const upper = sorted[mid]
  return sorted.length % 2 === 1 ? sorted[mid]! : (lower! + upper!) / 2
}

/** Median absolute deviation from the median. */
export function mad(values: readonly number[], center = median(values)): number {
  if (values.length === 0) return 0
  return median(values.map((value) => Math.abs(value - center)))
}

/**
 * Modified z-score (Iglewicz & Hoaglin, 1993): M = 0.6745·(x − median) / MAD.
 * Outlier if |M| > 3.5. Robust where the classic z-score masks outliers.
 * Returns 0 when MAD is 0 (constant series: nothing is an outlier, or the
 * series itself is the anomaly — that is STALE_PRICE's job, not ours).
 */
export function modifiedZScore(value: number, center: number, madValue: number): number {
  if (madValue === 0) return 0
  return (0.6745 * (value - center)) / madValue
}

/** Simple returns between consecutive closes. Pairs containing a non-positive close are skipped. */
export function simpleReturns(closes: readonly number[]): number[] {
  const returns: number[] = []
  for (let index = 0; index < closes.length - 1; index += 1) {
    const previous = closes[index]!
    const next = closes[index + 1]!
    if (previous > 0 && next > 0) returns.push(next / previous - 1)
  }
  return returns
}

/**
 * Hampel identifier: is `value` an outlier against its neighbourhood?
 * Uses median ± θ · (1.4826 · MAD) over the given window (MAD scaled to
 * approximate a standard deviation under normality). Standard spike filter
 * from the time-series literature.
 */
export function isHampelOutlier(window: readonly number[], value: number, theta: number): boolean {
  if (window.length < 3) return false
  const center = median(window)
  const sigma = 1.4826 * mad(window, center)
  if (sigma === 0) return value !== center
  return Math.abs(value - center) > theta * sigma
}
