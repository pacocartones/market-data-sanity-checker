/**
 * Minimal, deliberately conservative market calendar helpers.
 *
 * We do NOT ship exchange holiday calendars in the core (that is a maintenance
 * tar pit). Instead, gap rules only fire on absences too long to be explained
 * by a weekend plus a couple of holidays.
 */

/** Number of Mon–Fri days strictly between two timestamps. */
export function weekdaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0
  let count = 0
  const cursor = new Date(from)
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  while (cursor.getTime() < to) {
    const day = cursor.getUTCDay()
    if (day >= 1 && day <= 5) count += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}
