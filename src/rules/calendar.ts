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

  const millisecondsPerDay = 86_400_000
  const fromDay = Math.floor(from / millisecondsPerDay)
  const toDay = Math.floor(to / millisecondsPerDay)
  const fromTime = from - fromDay * millisecondsPerDay
  const toTime = to - toDay * millisecondsPerDay

  // Count the UTC calendar-day steps the previous loop would have visited.
  // Splitting day and time avoids subtracting endpoint timestamps beyond the
  // safe-integer range, while the remainder loop stays bounded to six days.
  const daysBetween = toDay - fromDay - (toTime <= fromTime ? 1 : 0)
  if (daysBetween <= 0) return 0

  const wholeWeeks = Math.floor(daysBetween / 7)
  let count = wholeWeeks * 5
  const remainingDays = daysBetween % 7
  const firstDay = (new Date(from).getUTCDay() + 1) % 7

  for (let offset = 0; offset < remainingDays; offset += 1) {
    const day = (firstDay + offset) % 7
    if (day >= 1 && day <= 5) count += 1
  }

  return count
}
