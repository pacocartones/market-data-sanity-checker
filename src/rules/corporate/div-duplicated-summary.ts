import type { Finding } from '../../report/types'
import type { MarketDataSet } from '../../schema/market-data'
import type { RuleContext } from '../types'
import { divDuplicated } from './div-duplicated'

const DAY_MS = 24 * 60 * 60 * 1000

interface TimedDividend {
  index: number
  time: number
  amount: number
}

interface MatchSummary {
  count: number
  firstIndex: number
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! < target) low = middle + 1
    else high = middle
  }
  return low
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! <= target) low = middle + 1
    else high = middle
  }
  return low
}

function heapPush(heap: number[], value: number): void {
  let child = heap.length
  heap.push(value)
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2)
    if (heap[parent]! <= value) break
    heap[child] = heap[parent]!
    child = parent
  }
  heap[child] = value
}

function heapPop(heap: number[]): void {
  const last = heap.pop()
  if (last === undefined || heap.length === 0) return
  let parent = 0
  while (parent * 2 + 1 < heap.length) {
    let child = parent * 2 + 1
    if (child + 1 < heap.length && heap[child + 1]! < heap[child]!) child += 1
    if (heap[child]! >= last) break
    heap[parent] = heap[child]!
    parent = child
  }
  heap[parent] = last
}

/** Active date-window dividends, indexed by amount for exact range counts. */
class ActiveAmounts {
  private readonly values: number[]
  private readonly positions: Map<number, number>
  private readonly size: number
  private readonly counts: number[]
  private readonly firstIndices: number[]
  private readonly heaps: number[][]
  private readonly active: boolean[]

  constructor(entries: readonly TimedDividend[], inputLength: number) {
    this.values = [...new Set(entries.map((entry) => entry.amount))].sort((a, b) => a - b)
    this.positions = new Map(this.values.map((value, index) => [value, index]))
    let size = 1
    while (size < this.values.length) size *= 2
    this.size = size
    this.counts = new Array<number>(size * 2).fill(0)
    this.firstIndices = new Array<number>(size * 2).fill(Number.POSITIVE_INFINITY)
    this.heaps = Array.from({ length: this.values.length }, () => [])
    this.active = new Array<boolean>(inputLength).fill(false)
  }

  add(entry: TimedDividend): void {
    const position = this.positions.get(entry.amount)!
    this.active[entry.index] = true
    heapPush(this.heaps[position]!, entry.index)
    this.refresh(position, 1)
  }

  remove(entry: TimedDividend): void {
    const position = this.positions.get(entry.amount)!
    this.active[entry.index] = false
    this.refresh(position, -1)
  }

  private refresh(position: number, delta: number): void {
    let node = this.size + position
    this.counts[node]! += delta
    const heap = this.heaps[position]!
    while (heap.length > 0 && !this.active[heap[0]!]) heapPop(heap)
    this.firstIndices[node] = heap[0] ?? Number.POSITIVE_INFINITY
    node = Math.floor(node / 2)
    while (node > 0) {
      this.counts[node] = this.counts[node * 2]! + this.counts[node * 2 + 1]!
      this.firstIndices[node] = Math.min(this.firstIndices[node * 2]!, this.firstIndices[node * 2 + 1]!)
      node = Math.floor(node / 2)
    }
  }

  private range(start: number, end: number): MatchSummary {
    let left = start + this.size
    let right = end + this.size
    let count = 0
    let firstIndex = Number.POSITIVE_INFINITY
    while (left < right) {
      if (left % 2 === 1) {
        count += this.counts[left]!
        firstIndex = Math.min(firstIndex, this.firstIndices[left++]!)
      }
      if (right % 2 === 1) {
        right -= 1
        count += this.counts[right]!
        firstIndex = Math.min(firstIndex, this.firstIndices[right]!)
      }
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return { count, firstIndex }
  }

  /** Original amount predicate, including zero and floating-point overflow. */
  private matches(amount: number, other: number, tolerance: number): boolean {
    const scale = Math.max(Math.abs(amount), Math.abs(other))
    return scale === 0
      ? amount === other
      : Math.abs(amount - other) / scale <= tolerance
  }

  matching(amount: number, tolerance: number): MatchSummary {
    const result: MatchSummary = { count: 0, firstIndex: Number.POSITIVE_INFINITY }
    const include = (start: number, end: number) => {
      if (start >= end) return
      const partial = this.range(start, end)
      result.count += partial.count
      result.firstIndex = Math.min(result.firstIndex, partial.firstIndex)
    }
    if (amount === 0) {
      if (tolerance >= 1) include(0, this.values.length)
      else include(lowerBound(this.values, 0), upperBound(this.values, 0))
      return result
    }
    if (Number.isNaN(tolerance) || tolerance < 0) return result
    if (tolerance === Number.POSITIVE_INFINITY) {
      include(0, this.values.length)
      return result
    }

    const magnitude = Math.abs(amount)
    const negativeEnd = upperBound(this.values, -magnitude)
    const zeroStart = lowerBound(this.values, 0)
    const positiveEnd = upperBound(this.values, magnitude)
    const segments: Array<[number, number, 'prefix' | 'suffix']> = amount > 0
      ? [
          [0, negativeEnd, 'prefix'],
          [negativeEnd, zeroStart, 'suffix'],
          [zeroStart, positiveEnd, 'suffix'],
          [positiveEnd, this.values.length, 'prefix'],
        ]
      : [
          [0, negativeEnd, 'suffix'],
          [negativeEnd, zeroStart, 'prefix'],
          [zeroStart, positiveEnd, 'prefix'],
          [positiveEnd, this.values.length, 'suffix'],
        ]

    for (const segment of segments) {
      let [start, end] = segment
      const direction = segment[2]
      if (start >= end) continue
      // Subtraction can overflow for opposite-sign finite values. In that
      // case the original predicate is false for finite tolerance, producing
      // a false prefix/suffix before the otherwise monotone segment.
      if (amount > 0 && start === 0) {
        let low = start
        let high = end
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (!Number.isFinite(amount - this.values[middle]!)) low = middle + 1
          else high = middle
        }
        start = low
      } else if (amount < 0 && end === this.values.length) {
        let low = start
        let high = end
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (Number.isFinite(amount - this.values[middle]!)) low = middle + 1
          else high = middle
        }
        end = low
      }
      if (start >= end) continue
      let low = start
      let high = end
      if (direction === 'prefix') {
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (this.matches(amount, this.values[middle]!, tolerance)) low = middle + 1
          else high = middle
        }
        include(start, low)
      } else {
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (this.matches(amount, this.values[middle]!, tolerance)) high = middle
          else low = middle + 1
        }
        include(low, end)
      }
    }
    return result
  }
}

/** Private report path. Public DIV_DUPLICATED.check still returns every pair. */
export function summarizeDuplicateDividends(
  data: MarketDataSet,
  context: RuleContext,
): Finding | undefined {
  const { windowDays, amountTolerancePct } = context.config.params as {
    windowDays: number
    amountTolerancePct: number
  }
  const dividends = data.dividends ?? []
  const entries: TimedDividend[] = []
  for (let index = 0; index < dividends.length; index += 1) {
    const dividend = dividends[index]!
    const time = Date.parse(dividend.exDate)
    if (Number.isNaN(time) || !Number.isFinite(dividend.amount)) continue
    entries.push({ index, time, amount: dividend.amount })
  }
  entries.sort((a, b) => a.time - b.time || a.index - b.index)

  const active = new ActiveAmounts(entries, dividends.length)
  let start = 0
  let occurrences = 0
  let firstPair: [number, number] | undefined
  for (let cursor = 0; cursor < entries.length; cursor += 1) {
    const current = entries[cursor]!
    while (start < cursor && (current.time - entries[start]!.time) / DAY_MS > windowDays) {
      active.remove(entries[start]!)
      start += 1
    }
    const matching = active.matching(current.amount, amountTolerancePct)
    occurrences += matching.count
    if (matching.count > 0) {
      const pair: [number, number] = [
        Math.min(matching.firstIndex, current.index),
        Math.max(matching.firstIndex, current.index),
      ]
      if (!firstPair || pair[0] < firstPair[0] || (pair[0] === firstPair[0] && pair[1] < firstPair[1])) {
        firstPair = pair
      }
    }
    active.add(current)
  }
  if (!firstPair) return undefined
  const first = dividends[firstPair[0]]!
  const second = dividends[firstPair[1]]!
  const representative = divDuplicated.check({ ...data, dividends: [first, second] }, context)[0]!
  return { ...representative, occurrences }
}
