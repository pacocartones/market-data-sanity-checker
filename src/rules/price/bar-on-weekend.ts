import { actionForSeverity, type Finding } from '../../report/types'
import type { Bar } from '../../schema/market-data'
import type { Rule } from '../types'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const


function hasNonMidnightTime(timestamp: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return false
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return false
  const date = new Date(parsed)
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0
}

function isIntradaySeries(bars: readonly Bar[]): boolean {
  if (bars.length === 0) return false
  const dates = new Set<string>()
  for (const bar of bars) {
    if (hasNonMidnightTime(bar.timestamp)) return true
    const day = bar.timestamp.slice(0, 10)
    if (dates.has(day)) return true
    dates.add(day)
  }
  return false
}

/**
 * BAR_ON_WEEKEND — flags a daily bar dated on a day the exchange does not trade.
 *
 * Usually caused by timezone or DST conversion shifting an exchange session by
 * a day (e.g. Yahoo daily bars stamped at 22:00–23:00 of the previous day shifting
 * a Monday bar to Sunday, or Paris daily bars landing one day early in UTC).
 *
 * Severity is `info` because special trading sessions occasionally occur on weekends
 * (e.g. India's Union Budget session on Saturday 2025-02-01).
 *
 * What it does not see: bars with a time of day are skipped; the rule reads daily,
 * date-only bars. A raw Yahoo bar stamped at 22:00–23:00 of the previous day is
 * therefore only caught once it has been reduced to a date (as the connector does),
 * and a single timed bar makes the whole series read as intraday and returns nothing.
 */
export const barOnWeekend: Rule = {
  meta: {
    id: 'BAR_ON_WEEKEND',
    block: 'price',
    severity: 'info',
    dimension: 'validity',
    description: 'Daily bar dated on a non-trading weekday (usually a timezone shift)',
    defaultParams: {
      /** Weekday 0 = Sunday. 1 = non-trading, 0 = trading. */
      sunday: 1,
      /** Weekday 1 = Monday. */
      monday: 0,
      /** Weekday 2 = Tuesday. */
      tuesday: 0,
      /** Weekday 3 = Wednesday. */
      wednesday: 0,
      /** Weekday 4 = Thursday. */
      thursday: 0,
      /** Weekday 5 = Friday. 1 for Gulf markets trading Sun–Thu. */
      friday: 0,
      /** Weekday 6 = Saturday. 1 = non-trading, 0 = trading. */
      saturday: 1,
      /** 1 = allow known exchange-specific special weekend sessions (e.g. NSE India Saturday Union Budget session 2025-02-01); 0 = flag all. */
      specialSessions: 1,
    },
    references: [
      'https://github.com/ranaroussi/yfinance/blob/5cae563642b59f49adf6a04a5ad6744f8b0e084d/yfinance/utils.py#L902-L911',
      'https://github.com/pbrissaud/suivi-bourse/pull/1016',
      'https://github.com/ranaroussi/yfinance/issues/1936',
      'https://nsearchives.nseindia.com/content/circulars/CMTR65729.pdf',
    ],
  },

  check(data, context) {
    if (data.bars.length === 0 || isIntradaySeries(data.bars)) {
      return []
    }

    const params = context.config.params as Record<string, unknown>
    const nonTradingDays = new Set<number>()

    // Check weekday params (sunday..saturday)
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    for (let i = 0; i < dayKeys.length; i += 1) {
      const key = dayKeys[i]!
      if (params[key] === 1 || params[key] === true) {
        nonTradingDays.add(i)
      }
    }

    const isNse = data.exchange?.toUpperCase() === 'NSE' || data.symbol.endsWith('.NS') || data.symbol.endsWith('.BO')
    const allowSpecialSessions = params.specialSessions === 1 || params.specialSessions === true

    const findings: Finding[] = []

    for (const bar of data.bars) {
      if (hasNonMidnightTime(bar.timestamp)) continue

      const parsed = Date.parse(bar.timestamp)
      if (Number.isNaN(parsed)) continue

      const date = new Date(parsed)
      const dayOfWeek = date.getUTCDay()
      const dateIso = date.toISOString().slice(0, 10)

      // Negative control: special exchange sessions (e.g. NSE India 2025-02-01)
      if (allowSpecialSessions && isNse && dateIso === '2025-02-01') continue

      if (!nonTradingDays.has(dayOfWeek)) continue

      const dayName = WEEKDAY_NAMES[dayOfWeek]!
      findings.push({
        rule: 'BAR_ON_WEEKEND',
        severity: context.config.severity,
        action: actionForSeverity(context.config.severity),
        dimension: 'validity',
        where: { date: bar.timestamp },
        explanation:
          `Daily bar dated on a non-trading weekday (${dayName}, ${bar.timestamp}). ` +
          `Hypothesis: a timezone or UTC conversion shifted a regular trading day into the weekend ` +
          `(e.g. Yahoo daily bars stamped at 22:00–23:00 of the previous day shifting a Monday bar to Sunday, or Paris daily bars ` +
          `landing early in UTC), or an unannounced special weekend session. Review before consuming.`,
        evidence: {
          date: bar.timestamp,
          weekday: dayName,
          day_of_week: dayOfWeek,
        },
      })
    }

    return findings
  },
}
