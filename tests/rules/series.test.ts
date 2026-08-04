import { describe, expect, it } from 'vitest'
import type { Bar } from '../../src/schema/market-data'
import { sortedBars } from '../../src/rules/series'

function bar(timestamp: string, close = 100): Bar {
  return { timestamp, open: close, high: close, low: close, close }
}

function timestamps(bars: readonly Bar[]): string[] {
  return bars.map((entry) => entry.timestamp)
}

describe('sortedBars', () => {
  it('sorts parseable bars chronologically and moves unparseable ones to the end, in original order', () => {
    const input = [bar('2024-01-05'), bar('garbage'), bar('2024-01-02')]
    expect(timestamps(sortedBars(input))).toEqual(['2024-01-02', '2024-01-05', 'garbage'])
  })

  it('keeps parseable bars ordered among themselves with several unparseable bars interleaved', () => {
    // NB: pick strings Date.parse really rejects — V8 parses 'nope-1' as a date.
    const input = [
      bar('garbage'),
      bar('2024-03-01'),
      bar('also-garbage'),
      bar('2024-01-01'),
      bar('2024-02-01'),
    ]
    expect(timestamps(sortedBars(input))).toEqual(['2024-01-01', '2024-02-01', '2024-03-01', 'garbage', 'also-garbage'])
  })

  it('is stable: equal timestamps keep their input relative order', () => {
    const first = bar('2024-01-02', 1)
    const second = bar('2024-01-02', 2)
    const sorted = sortedBars([bar('2024-01-03', 3), first, second])
    expect(sorted[0]).toBe(first)
    expect(sorted[1]).toBe(second)
    expect(sorted[2]!.close).toBe(3)
  })

  it('keeps the input order when every timestamp is unparseable', () => {
    const input = [bar('b'), bar('a'), bar('c')]
    expect(timestamps(sortedBars(input))).toEqual(['b', 'a', 'c'])
  })

  it('handles an empty input', () => {
    expect(sortedBars([])).toEqual([])
  })

  it('does not mutate the input array', () => {
    const input = [bar('2024-01-05'), bar('garbage'), bar('2024-01-02')]
    const snapshot = [...input]
    sortedBars(input)
    expect(input).toEqual(snapshot)
  })
})
