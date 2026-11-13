const MS_PER_DAY = 24 * 60 * 60 * 1000

interface DatedValue {
  exDate: string
}

interface IndexedValue {
  originalIndex: number
  time: number
}

function lowerBound(values: readonly IndexedValue[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]!.time < target) low = middle + 1
    else high = middle
  }
  return low
}

function upperBound(values: readonly IndexedValue[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]!.time <= target) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Indexes dated values for logarithmic window lookups. The range-min tree
 * returns the earliest value in original input order, preserving Array.find's
 * matching semantics when several corporate actions share a date window.
 */
export function createDateWindowIndex<T extends DatedValue>(values: readonly T[]): {
  find(exDate: string, windowDays: number): T | undefined
} {
  const sorted: IndexedValue[] = values
    .map((value, originalIndex) => ({ originalIndex, time: Date.parse(value.exDate) }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((a, b) => a.time - b.time || a.originalIndex - b.originalIndex)

  let treeSize = 1
  while (treeSize < sorted.length) treeSize *= 2
  const minimumOriginalIndex = new Array<number>(treeSize * 2).fill(Number.POSITIVE_INFINITY)
  for (let index = 0; index < sorted.length; index += 1) {
    minimumOriginalIndex[treeSize + index] = sorted[index]!.originalIndex
  }
  for (let index = treeSize - 1; index > 0; index -= 1) {
    minimumOriginalIndex[index] = Math.min(
      minimumOriginalIndex[index * 2]!,
      minimumOriginalIndex[index * 2 + 1]!,
    )
  }

  const minimumInRange = (start: number, end: number): number => {
    let left = start + treeSize
    let right = end + treeSize
    let minimum = Number.POSITIVE_INFINITY
    while (left < right) {
      if (left % 2 === 1) minimum = Math.min(minimum, minimumOriginalIndex[left++]!)
      if (right % 2 === 1) minimum = Math.min(minimum, minimumOriginalIndex[--right]!)
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return minimum
  }

  return {
    find(exDate, windowDays) {
      const time = Date.parse(exDate)
      const windowMs = windowDays * MS_PER_DAY
      if (Number.isNaN(time) || Number.isNaN(windowMs) || windowMs < 0) return undefined

      const start = lowerBound(sorted, time - windowMs)
      const end = upperBound(sorted, time + windowMs)
      if (start === end) return undefined
      const originalIndex = minimumInRange(start, end)
      return Number.isFinite(originalIndex) ? values[originalIndex] : undefined
    },
  }
}
