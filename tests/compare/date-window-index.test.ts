import { describe, expect, it } from 'vitest'
import { createDateWindowIndex } from '../../src/compare/date-window-index'

describe('corporate action date index', () => {
  it('keeps an exact fractional-day boundary despite multiplication rounding', () => {
    const values = [{ exDate: '1970-01-01T00:00:00.031Z', id: 1 }]
    const windowDays = 31 / (24 * 60 * 60 * 1000)
    expect(createDateWindowIndex(values).find('1970-01-01T00:00:00.000Z', windowDays))
      .toEqual(values[0])
  })

  it('matches the original first-candidate search on bounded varied windows', () => {
    let seed = 0x6e351
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const dates = ['2024-01-01', '2024-01-02', '2024-01-02T12:00:00Z',
      '2024-01-05', '2024-01-12', 'invalid']
    const windows = [-1, 0, 0.5, 1, 3, 7, Number.NaN, Number.POSITIVE_INFINITY]
    const msPerDay = 24 * 60 * 60 * 1000
    for (let sample = 0; sample < 250; sample += 1) {
      const values = Array.from({ length: Math.floor(random() * 12) }, (_, index) => ({
        exDate: dates[Math.floor(random() * dates.length)]!, id: index,
      }))
      const index = createDateWindowIndex(values)
      for (const exDate of dates) {
        for (const windowDays of windows) {
          const expected = values.find((candidate) =>
            Math.abs(Date.parse(exDate) - Date.parse(candidate.exDate)) / msPerDay <= windowDays)
          expect(index.find(exDate, windowDays), `sample ${sample}, ${exDate}, ${windowDays}`)
            .toEqual(expected)
        }
      }
    }
  })
})
