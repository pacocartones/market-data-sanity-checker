/**
 * Timestamp normalization for ingested data.
 *
 * Real-world CSV/JSON exports reach us with dates in three shapes beyond ISO:
 * compact calendar dates (YYYYMMDD, e.g. Bloomberg/Excel exports) and epoch
 * seconds (e.g. '1704153600'), as strings or — after dynamicTyping — numbers.
 * Left as-is they poison every downstream consumer (schema rejects them, or
 * worse, lexicographic date comparison silently misorders). Both ingesters
 * normalize through here so the fix lives in exactly one place.
 *
 * Deliberately conservative: anything that is not UNAMBIGUOUSLY one of those
 * two shapes is returned unchanged, so schema validation and the rules engine
 * see the raw evidence instead of a guess (2026-07-31 audit: ingest must
 * normalize the obvious, never fabricate).
 */

/** Compact calendar date: YYYYMMDD. */
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/

/** Epoch-seconds candidates are exactly 10 digits. */
const EPOCH_SECONDS = /^\d{10}$/

/**
 * Plausibility window for epoch-seconds values: [1990-01-01, 2100-01-01) UTC.
 * Daily market data outside that window is not a plausible trading date.
 */
const MIN_EPOCH_SECONDS = Date.UTC(1990, 0, 1) / 1000 // 631152000
const MAX_EPOCH_SECONDS = Date.UTC(2100, 0, 1) / 1000 // 4102444800

/** True when (year, month, day) is a real calendar date (catches e.g. Feb 30, month 13). */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normalizeDigits(digits: string): string {
  const compact = COMPACT_DATE.exec(digits)
  if (compact) {
    const year = Number(compact[1])
    const month = Number(compact[2])
    const day = Number(compact[3])
    if (isValidCalendarDate(year, month, day)) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`
    }
    return digits
  }
  if (EPOCH_SECONDS.test(digits)) {
    const epochSeconds = Number(digits)
    if (epochSeconds >= MIN_EPOCH_SECONDS && epochSeconds < MAX_EPOCH_SECONDS) {
      // UTC by design: a bare epoch carries no session-timezone information.
      return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
    }
  }
  return digits
}

/**
 * Normalizes an ingested timestamp to an ISO calendar date when it is
 * unambiguously a compact date or a plausible epoch-seconds value:
 * - '20240102' or 20240102 → '2024-01-02'
 * - 1704153600 or '1704153600' → '2024-01-02' (epoch seconds, UTC)
 * - '2024-01-02' (already ISO) or anything else → returned unchanged.
 *
 * Numbers are normalized through their decimal string form, so fractional or
 * non-digit values (e.g. NaN, 1.5) fall through untouched.
 */
export function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? normalizeDigits(String(value)) : String(value)
  }
  if (typeof value === 'string') {
    return normalizeDigits(value)
  }
  return String(value)
}
