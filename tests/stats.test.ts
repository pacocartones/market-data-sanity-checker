import { describe, expect, it } from 'vitest'
import { isHampelOutlier, mad, median, modifiedZScore, simpleReturns } from '../src/rules/stats'
import { matchSplitRatio } from '../src/rules/helpers'
import { weekdaysBetween } from '../src/rules/calendar'

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('returns 0 on empty input', () => {
    expect(median([])).toBe(0)
  })
})

describe('mad', () => {
  it('computes median absolute deviation', () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1)
  })
})

describe('modifiedZScore', () => {
  it('flags a strong outlier above 3.5', () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 4, 5, 100]
    const center = median(values)
    expect(Math.abs(modifiedZScore(100, center, mad(values, center)))).toBeGreaterThan(3.5)
  })
  it('returns 0 when MAD is 0 (constant series)', () => {
    expect(modifiedZScore(5, 5, 0)).toBe(0)
  })
})

describe('simpleReturns', () => {
  it('computes consecutive returns and skips non-positive closes', () => {
    const returns = simpleReturns([100, 110, 99])
    expect(returns[0]).toBeCloseTo(0.1, 10)
    expect(returns[1]).toBeCloseTo(-0.1, 10)
    expect(simpleReturns([100, 0, 50])).toEqual([])
  })
})

describe('isHampelOutlier', () => {
  it('flags an isolated spike but not the neighbourhood', () => {
    const window = [100, 101, 99, 100, 102, 98, 101]
    expect(isHampelOutlier(window, 185, 3)).toBe(true)
    expect(isHampelOutlier(window, 101, 3)).toBe(false)
  })
})

describe('matchSplitRatio', () => {
  // Contract since 2026-07-31: tolerance is RELATIVE to the implied return —
  // |observed − implied| ≤ tolerance × |implied| — so the band scales with the
  // jump and absorbs ordinary split-day volatility.
  it('matches common split ratios within relative tolerance', () => {
    expect(matchSplitRatio(-0.497, 0.05)).toBe('2:1')
    expect(matchSplitRatio(-0.752, 0.05)).toBe('4:1')
    expect(matchSplitRatio(4.02, 0.05)).toBe('1:5 (reverse)')
  })
  it('absorbs real split-day noise the old absolute band rejected', () => {
    // 2:1 split landing on a −5% day shows −52.5% — inside ±5% of −50%.
    expect(matchSplitRatio(-0.525, 0.05)).toBe('2:1')
    // 1:10 reverse landing on a +2% day shows +920% — inside ±5% of +900%.
    expect(matchSplitRatio(9.2, 0.05)).toBe('1:10 (reverse)')
  })
  it('covers the extended ratio table (7:1, 20:1, 1:8 and 1:20 reverses)', () => {
    expect(matchSplitRatio(-0.857, 0.05)).toBe('7:1')
    expect(matchSplitRatio(-0.95, 0.05)).toBe('20:1')
    expect(matchSplitRatio(7, 0.05)).toBe('1:8 (reverse)')
    expect(matchSplitRatio(19, 0.05)).toBe('1:20 (reverse)')
  })
  it('returns undefined just outside the band and for ordinary moves', () => {
    // The 2:1 band at 0.05 ends at −52.5%; −53% is beyond it.
    expect(matchSplitRatio(-0.53, 0.05)).toBeUndefined()
    expect(matchSplitRatio(-0.03, 0.05)).toBeUndefined()
  })
})

describe('weekdaysBetween', () => {
  it('counts only Mon–Fri days strictly between two dates', () => {
    // Fri 2024-01-05 → Mon 2024-01-08: 0 weekdays between (weekend only)
    expect(weekdaysBetween('2024-01-05', '2024-01-08')).toBe(0)
    // Mon 2024-01-01 → Mon 2024-01-15: 9 weekdays strictly between (Jan 2-5 and 8-12)
    expect(weekdaysBetween('2024-01-01', '2024-01-15')).toBe(9)
  })
})
