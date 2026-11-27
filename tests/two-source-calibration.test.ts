import { describe, expect, it } from 'vitest'
import { ConnectorError } from '../src/connectors/types'
import { registry } from '../src/rules/registry'
import type { Bar, MarketDataSet } from '../src/schema/market-data'
import {
  buildTwoSourceReport,
  classifyFinding,
  computeOverlap,
  looksLikeAlphaVantageKey,
  MIN_SECRET_LENGTH,
  NOT_COMPARABLE_RULES,
  redactSecrets,
  safeErrorMessage,
  TWO_SOURCE_SYMBOLS,
  type ClassificationInput,
  type DatedFinding,
} from '../scripts/two-source-calibration'

const OVERLAP = { from: '2026-07-01', to: '2026-11-20' }

function finding(rule: string, date: string | null): DatedFinding {
  return { rule, severity: 'warning', date, explanation: `${rule} on ${date ?? 'series'}` }
}

function input(overrides: Partial<ClassificationInput> & { finding: DatedFinding }): ClassificationInput {
  return {
    overlap: OVERLAP,
    secondSourceDates: new Set(['2026-07-01', '2026-08-03', '2026-11-20']),
    secondSourceFindings: [],
    compareFindings: [],
    ...overrides,
  }
}

describe('classifyFinding', () => {
  it('corroborates when the same rule fires on the second source at the same date', () => {
    expect(
      classifyFinding(
        input({
          finding: finding('RETURN_SPIKE', '2026-08-03'),
          secondSourceFindings: [finding('RETURN_SPIKE', '2026-08-03')],
        }),
      ),
    ).toEqual({ classification: 'corroborated', basis: 'same-rule', by: 'RETURN_SPIKE' })
  })

  it('corroborates when the compare engine finds a disagreement at that date', () => {
    expect(
      classifyFinding(
        input({
          finding: finding('PRICE_SPIKE_INTRADAY', '2026-08-03'),
          compareFindings: [finding('PRICE_DATE_MISMATCH', '2026-08-03')],
        }),
      ),
    ).toEqual({ classification: 'corroborated', basis: 'compare', by: 'PRICE_DATE_MISMATCH' })
  })

  it('does not corroborate on the same rule at another date', () => {
    expect(
      classifyFinding(
        input({
          finding: finding('RETURN_SPIKE', '2026-08-03'),
          secondSourceFindings: [finding('RETURN_SPIKE', '2026-11-20')],
          compareFindings: [finding('PRICE_DATE_MISMATCH', '2026-07-01')],
        }),
      ),
    ).toEqual({ classification: 'contradicted' })
  })

  it('contradicts when the second source has a clean, agreeing bar at that date', () => {
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-08-03') }))).toEqual({
      classification: 'contradicted',
    })
  })

  it('ignores not-comparable second-source rules when judging a bar clean', () => {
    // Alpha Vantage free has no currency, so CURRENCY_SUSPECT fires on its last bar: not evidence.
    expect(
      classifyFinding(
        input({
          finding: finding('STALE_PRICE', '2026-11-20'),
          secondSourceFindings: [finding('CURRENCY_SUSPECT', '2026-11-20')],
        }),
      ),
    ).toEqual({ classification: 'contradicted' })
  })

  it('is not comparable when a different comparable rule fires on the second source there', () => {
    expect(
      classifyFinding(
        input({
          finding: finding('RETURN_SPIKE', '2026-08-03'),
          secondSourceFindings: [finding('PRICE_SPIKE_INTRADAY', '2026-08-03')],
        }),
      ),
    ).toEqual({ classification: 'not_comparable', reason: 'second-source-not-clean' })
  })

  it('is not comparable when the second source has no bar at that date', () => {
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-08-04') }))).toEqual({
      classification: 'not_comparable',
      reason: 'no-second-source-bar',
    })
  })

  it('treats both overlap ends as inside and the day beyond as outside', () => {
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-07-01') }))).toEqual({
      classification: 'contradicted',
    })
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-11-20') }))).toEqual({
      classification: 'contradicted',
    })
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-06-30') }))).toEqual({
      classification: 'not_comparable',
      reason: 'outside-overlap',
    })
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-11-21') }))).toEqual({
      classification: 'not_comparable',
      reason: 'outside-overlap',
    })
  })

  it('is not comparable without any overlap or without a date', () => {
    expect(classifyFinding(input({ finding: finding('RETURN_SPIKE', '2026-08-03'), overlap: null }))).toEqual({
      classification: 'not_comparable',
      reason: 'outside-overlap',
    })
    expect(classifyFinding(input({ finding: finding('INSUFFICIENT_DATA', null) }))).toEqual({
      classification: 'not_comparable',
      reason: 'no-date',
    })
  })

  it('marks corporate-action rules not comparable even when the second source would agree', () => {
    expect(
      classifyFinding(
        input({
          finding: finding('DIV_SCALE_100X', '2026-08-03'),
          secondSourceFindings: [finding('DIV_SCALE_100X', '2026-08-03')],
          compareFindings: [finding('CLOSE_DIVERGENCE', '2026-08-03')],
        }),
      ),
    ).toEqual({ classification: 'not_comparable', reason: 'needs-dividends' })
    expect(classifyFinding(input({ finding: finding('SPLIT_NOT_ADJUSTED', '2026-08-03') }))).toEqual({
      classification: 'not_comparable',
      reason: 'needs-splits',
    })
    expect(classifyFinding(input({ finding: finding('CORPORATE_ACTION_MISSING_FROM_FACTOR', '2026-08-03') }))).toEqual({
      classification: 'not_comparable',
      reason: 'needs-adjustment-factors',
    })
  })

  it('does not treat Object.prototype keys as rule ids', () => {
    expect(classifyFinding(input({ finding: finding('constructor', '2026-08-03') }))).toEqual({
      classification: 'contradicted',
    })
  })
})

describe('not-comparable rule list', () => {
  it('names only rules that exist, and every corporate, fundamentals and metadata rule', () => {
    const ids = new Set(registry.map((rule) => rule.meta.id))
    for (const rule of Object.keys(NOT_COMPARABLE_RULES)) expect(ids).toContain(rule)
    for (const rule of registry.filter((entry) => entry.meta.block !== 'price')) {
      expect(Object.keys(NOT_COMPARABLE_RULES)).toContain(rule.meta.id)
    }
  })
})

describe('two-source basket', () => {
  it('has at most 24 distinct symbols, all from the calibration list', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../scripts/calibrate.ts', import.meta.url), 'utf8')
    expect(TWO_SOURCE_SYMBOLS.length).toBeLessThanOrEqual(24)
    expect(new Set(TWO_SOURCE_SYMBOLS).size).toBe(TWO_SOURCE_SYMBOLS.length)
    for (const symbol of TWO_SOURCE_SYMBOLS) expect(source).toContain(`'${symbol}'`)
  })
})

describe('safeErrorMessage', () => {
  it('keeps categorized connector errors and withholds anything else', () => {
    expect(safeErrorMessage(new ConnectorError('Alpha Vantage HTTP 503 fetching KO'))).toBe(
      'Alpha Vantage HTTP 503 fetching KO',
    )
    expect(safeErrorMessage(new Error('raw provider body: {"secret": true}'))).toBe('request failed (details withheld)')
    expect(safeErrorMessage(new ConnectorError('echo key-123 back'), ['key-123'])).toBe('echo [redacted] back')
  })
})

describe('redactSecrets', () => {
  it('redacts a real-length secret everywhere', () => {
    expect(redactSecrets('a ABCDEFGH12345678 b ABCDEFGH12345678', ['ABCDEFGH12345678'])).toBe('a [redacted] b [redacted]')
  })
  it('ignores placeholders shorter than MIN_SECRET_LENGTH, which would rewrite dates and symbols', () => {
    expect(MIN_SECRET_LENGTH).toBe(6)
    const text = '{"date":"2026-11-27","symbol":"BRK-B","return":-0.061}'
    expect(redactSecrets(text, ['-', '', undefined, '12345'])).toBe(text)
  })
})

describe('looksLikeAlphaVantageKey', () => {
  it('accepts 12 or more letters and digits', () => {
    expect(looksLikeAlphaVantageKey('ABCDEFGH12345678')).toBe(true)
  })
  it('rejects placeholders and malformed values', () => {
    for (const value of [undefined, '', '-', 'demo', 'changeme', 'ABCD-EFGH-1234', '-\n-']) {
      expect(looksLikeAlphaVantageKey(value)).toBe(false)
    }
  })
})

/** Weekday bars from `start`, closes from `closes`; a tight range keeps the intraday rules quiet. */
function series(source: string, start: string, closes: number[]): MarketDataSet {
  const bars: Bar[] = []
  let cursor = Date.parse(`${start}T00:00:00Z`)
  let index = 0
  while (bars.length < closes.length) {
    const date = new Date(cursor)
    cursor += 86_400_000
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue
    const close = closes[index++]!
    bars.push({
      timestamp: date.toISOString().slice(0, 10),
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 1_000_000,
    })
  }
  return { symbol: 'FAKE', source, currency: 'USD', bars }
}

/** A gentle deterministic wiggle around 100, so return statistics are not degenerate. */
function wiggle(length: number): number[] {
  return Array.from({ length }, (_, i) => 100 * (1 + 0.004 * Math.sin(i * 1.7) + 0.002 * Math.cos(i * 0.9)))
}

describe('buildTwoSourceReport', () => {
  // Yahoo: 130 sessions; Alpha Vantage: the last 100 of them, identical closes except one bad print.
  const yahooCloses = wiggle(130)
  yahooCloses[120] = yahooCloses[119]! * 1.25 // spike on Yahoo only
  const yahooSeries = series('yahoo', '2026-05-04', yahooCloses)
  const avCloses = wiggle(130).slice(30)
  const avSeries = series('alpha-vantage', yahooSeries.bars[30]!.timestamp, avCloses)
  delete avSeries.currency

  const report = buildTwoSourceReport({
    generatedAt: '2026-11-27T00:00:00.000Z',
    symbols: ['FAKE', 'CAPPED', 'BROKEN'],
    pairs: [{ symbol: 'FAKE', yahoo: yahooSeries, alphaVantage: avSeries }],
    skipped: ['CAPPED'],
    failed: [{ symbol: 'BROKEN', provider: 'alpha-vantage', error: 'Alpha Vantage request failed for BROKEN' }],
  })

  it('has the documented top-level shape', () => {
    expect(Object.keys(report)).toEqual([
      'generated_at',
      'mode',
      'providers',
      'alpha_vantage_tier',
      'range',
      'symbols',
      'disabled_compare_rules',
      'results',
      'skipped',
      'failed',
      'summary',
    ])
    expect(report.generated_at).toBe('2026-11-27T00:00:00.000Z')
    expect(report.providers).toEqual(['yahoo', 'alpha-vantage'])
    expect(report.alpha_vantage_tier).toBe('free')
    expect(report.range).toEqual({ yahoo: '6mo', alpha_vantage: 'compact (latest 100 sessions)' })
    expect(report.disabled_compare_rules).toEqual(['DIVIDEND_MISMATCH', 'SPLIT_MISMATCH'])
    expect(report.skipped).toEqual([{ symbol: 'CAPPED', reason: 'daily-request-cap' }])
    expect(report.failed).toEqual([
      { symbol: 'BROKEN', provider: 'alpha-vantage', error: 'Alpha Vantage request failed for BROKEN' },
    ])
  })

  it('reports the overlap per symbol', () => {
    const [result] = report.results
    expect(result!.symbol).toBe('FAKE')
    expect(result!.bars).toEqual({ yahoo: 130, alpha_vantage: 100 })
    expect(result!.overlap).toEqual({
      from: yahooSeries.bars[30]!.timestamp,
      to: yahooSeries.bars[129]!.timestamp,
      sessions: 100,
      yahoo_only: 0,
      alpha_vantage_only: 0,
    })
    expect(computeOverlap(yahooSeries, avSeries)).toEqual({ from: result!.overlap!.from, to: result!.overlap!.to })
    expect(typeof result!.consistency_score).toBe('number')
  })

  it('classifies the Yahoo-only spike as corroborated by the compare engine', () => {
    const [result] = report.results
    const spikeDate = yahooSeries.bars[120]!.timestamp
    const atSpike = result!.findings.filter((entry) => entry.date === spikeDate)
    expect(atSpike.length).toBeGreaterThan(0)
    for (const entry of atSpike) {
      expect(entry.classification).toBe('corroborated')
      expect(entry.basis).toBe('compare')
    }
    expect(result!.compare_findings.some((entry) => entry.date === spikeDate)).toBe(true)
    for (const entry of result!.findings) {
      expect(['corroborated', 'contradicted', 'not_comparable']).toContain(entry.classification)
      expect(Object.keys(entry)).toEqual(expect.arrayContaining(['rule', 'severity', 'date', 'explanation', 'classification']))
    }
  })

  it('summarizes per rule, consistent with the findings', () => {
    const findings = report.results.flatMap((result) => result.findings)
    expect(report.summary.symbols_compared).toBe(1)
    expect(report.summary.symbols_skipped).toBe(1)
    expect(report.summary.symbols_failed).toBe(1)
    expect(report.summary.totals.fired).toBe(findings.length)
    for (const [rule, entry] of Object.entries(report.summary.by_rule)) {
      const mine = findings.filter((item) => item.rule === rule)
      expect(entry.fired).toBe(mine.length)
      expect(entry.corroborated + entry.contradicted + entry.not_comparable).toBe(entry.fired)
      expect(entry.corroborated).toBe(mine.filter((item) => item.classification === 'corroborated').length)
    }
  })

  it('round-trips through JSON', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })
})
