import type { Finding } from '../../report/types'
import type { Split } from '../../schema/market-data'
import type { CompareRule } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Absolute distance between two ex-dates, in calendar days. */
function daysApart(x: string, y: string): number {
  return Math.abs(Date.parse(x) - Date.parse(y)) / MS_PER_DAY
}

/** Split ratio as a single number: 2 for a 2:1 split, 0.5 for a 1:2 reverse split. */
function ratioOf(split: Split): number {
  return split.numerator / split.denominator
}

/**
 * SPLIT_MISMATCH — a split present in one source is missing or carries a
 * different ratio in the other.
 *
 * A split absent from one feed is the single most damaging corporate-action
 * discrepancy: the unadjusted feed shows a 2:1 split as an overnight −50%
 * crash — the phantom move SPLIT_NOT_ADJUSTED hunts in single-source data
 * (see yfinance discussion #2183 for real cases of feeds missing splits).
 * A mismatched ratio is subtler but just as corrupting for back-adjusted
 * series. Each mismatch is reported per ex-date with both ratios.
 */
export const splitMismatch: CompareRule = {
  meta: {
    id: 'SPLIT_MISMATCH',
    severity: 'warning',
    dimension: 'consistency',
    description: 'Split present in one source but missing or with a different ratio in the other',
    defaultParams: {
      /** Maximum distance (calendar days) between ex-dates to consider two splits the same event. */
      matchWindowDays: 7,
      /** Relative ratio difference (fraction) above which matched splits are flagged. */
      ratioTolerancePct: 0.01,
    },
    references: ['https://github.com/ranaroussi/yfinance/discussions/2183'],
  },

  check(a, b, context) {
    const { matchWindowDays, ratioTolerancePct } = context.config.params as {
      matchWindowDays: number
      ratioTolerancePct: number
    }
    const splitsA = a.splits ?? []
    const splitsB = b.splits ?? []

    const matchIn = (split: Split, candidates: readonly Split[]): Split | undefined =>
      candidates.find((candidate) => daysApart(split.exDate, candidate.exDate) <= matchWindowDays)

    const findings: Finding[] = []

    for (const split of splitsA) {
      const ratioA = ratioOf(split)
      const match = matchIn(split, splitsB)
      if (!match) {
        findings.push({
          rule: 'SPLIT_MISMATCH',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          where: { date: split.exDate },
          explanation:
            `${a.source} reports a ${a.symbol} split of ${split.numerator}:${split.denominator} with ex-date ` +
            `${split.exDate}, but ${b.source} has no split within ${matchWindowDays} days of it. A missing split ` +
            `is the gravest corporate-action discrepancy: in the unadjusted feed it surfaces as a phantom ` +
            `overnight crash (a 2:1 split looks like −50%), exactly the failure SPLIT_NOT_ADJUSTED detects ` +
            `single-source. Treat ${b.source}'s prices around this date as unadjusted until reconciled.`,
          evidence: {
            reason: 'missing_in_b',
            exDate: split.exDate,
            ratio_a: Number(ratioA.toFixed(4)),
          },
        })
        continue
      }
      const ratioB = ratioOf(match)
      const scale = Math.max(Math.abs(ratioA), Math.abs(ratioB))
      const divergence = scale === 0 ? 0 : Math.abs(ratioA - ratioB) / scale
      if (divergence > ratioTolerancePct) {
        findings.push({
          rule: 'SPLIT_MISMATCH',
          severity: context.config.severity,
          action: 'flag',
          dimension: 'consistency',
          where: { date: split.exDate },
          explanation:
            `${a.source} and ${b.source} both report a ${a.symbol} split around ${split.exDate}, but the ratios ` +
            `differ: ${split.numerator}:${split.denominator} (${ratioA.toFixed(4)}) vs ${match.numerator}:` +
            `${match.denominator} (${ratioB.toFixed(4)}). Back-adjusted series built from the wrong ratio are ` +
            `silently wrong by that factor — reconcile against the issuer's corporate-action notice before use.`,
          evidence: {
            reason: 'ratio_differs',
            exDate: split.exDate,
            ratio_a: Number(ratioA.toFixed(4)),
            ratio_b: Number(ratioB.toFixed(4)),
          },
        })
      }
    }

    for (const split of splitsB) {
      if (matchIn(split, splitsA)) continue
      findings.push({
        rule: 'SPLIT_MISMATCH',
        severity: context.config.severity,
        action: 'flag',
        dimension: 'consistency',
        where: { date: split.exDate },
        explanation:
          `${b.source} reports a ${b.symbol} split of ${split.numerator}:${split.denominator} with ex-date ` +
          `${split.exDate}, but ${a.source} has no split within ${matchWindowDays} days of it. A missing split ` +
          `is the gravest corporate-action discrepancy: in the unadjusted feed it surfaces as a phantom ` +
          `overnight crash (a 2:1 split looks like −50%), exactly the failure SPLIT_NOT_ADJUSTED detects ` +
          `single-source. Treat ${a.source}'s prices around this date as unadjusted until reconciled.`,
        evidence: {
          reason: 'missing_in_a',
          exDate: split.exDate,
          ratio_b: Number(ratioOf(split).toFixed(4)),
        },
      })
    }

    return findings
  },
}
