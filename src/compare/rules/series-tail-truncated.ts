import { actionForSeverity, type Finding } from '../../report/types'
import type { CompareRule } from '../types'

/**
 * SERIES_TAIL_TRUNCATED — one source stops before the other does.
 *
 * Counting shared sessions hides this case: if the overlap is long enough,
 * INSUFFICIENT_OVERLAP stays silent, and BAR_MISSING only sees gaps BETWEEN
 * bars, so a series that is simply cut short at its end has none. The
 * comparison then reports agreement while one feed is missing the most recent
 * sessions the other one has, which is usually the data a caller wanted.
 *
 * Only the tail is judged. A different START date is normal (vendors serve
 * different history lengths) and is not a finding. The default threshold is
 * two sessions, so a feed that has not yet published today's bar is not
 * reported. The case was reported in issue #35, from a regression where two
 * authority dates absent from the subject still produced a PASS.
 */
export const seriesTailTruncated: CompareRule = {
  meta: {
    id: 'SERIES_TAIL_TRUNCATED',
    severity: 'warning',
    dimension: 'completeness',
    description: 'One source ends sessions before the other — its most recent bars are missing',
    defaultParams: {
      /** Sessions the other source has after this one ends, at or above which the truncation is reported. */
      minMissingSessions: 2,
      /** Missing dates listed in the evidence; the count is always complete. */
      maxListedDates: 20,
    },
    references: [
      'https://github.com/pacocartones/market-data-sanity-checker/issues/35',
      'https://github.com/arian-gogani/nobulex-registry/blob/main/examples/wrong_window.py',
    ],
  },

  check(a, b, context) {
    const { minMissingSessions, maxListedDates } = context.config.params as {
      minMissingSessions: number
      maxListedDates: number
    }
    // Without any shared session there is no common story to cut short; INSUFFICIENT_OVERLAP owns that case.
    if (context.shared.length === 0) return []

    const lastA = lastDate(context.shared, context.onlyInA)
    const lastB = lastDate(context.shared, context.onlyInB)
    const findings: Finding[] = []
    for (const [short, long, shortLast, missing] of [
      [a, b, lastA, context.onlyInB.filter((date) => date > lastA)],
      [b, a, lastB, context.onlyInA.filter((date) => date > lastB)],
    ] as const) {
      if (missing.length < minMissingSessions) continue
      findings.push({
        rule: 'SERIES_TAIL_TRUNCATED',
        severity: context.config.severity,
        action: actionForSeverity(context.config.severity),
        dimension: 'completeness',
        where: { date: missing[0]! },
        explanation:
          `${short.source} ends on ${shortLast} for ${short.symbol}, but ${long.source} has ` +
          `${missing.length} later session(s), from ${missing[0]} to ${missing[missing.length - 1]}. ` +
          `The shared dates can agree while ${short.source} is missing its most recent bars: a truncated ` +
          `or stale fetch. Re-fetch ${short.source} before trusting it for the latest sessions.`,
        evidence: {
          truncated_source: short.source,
          last_date: shortLast,
          other_source: long.source,
          missing_sessions: missing.length,
          missing_dates: missing.slice(0, maxListedDates),
        },
      })
    }
    return findings
  },
}

/** Latest YYYY-MM-DD date of one source: the later of its last shared date and its last date of its own. */
function lastDate(shared: ReadonlyArray<{ date: string }>, onlyHere: readonly string[]): string {
  const lastShared = shared[shared.length - 1]!.date
  const lastOwn = onlyHere[onlyHere.length - 1]
  return lastOwn !== undefined && lastOwn > lastShared ? lastOwn : lastShared
}
