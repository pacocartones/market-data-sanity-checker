import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORY_DIR,
  appendHistory,
  formatHistory,
  historyEntryFromReport,
  readHistory,
} from '../src/history/store'
import type { HistoryEntry } from '../src/history/store'
import type { Finding, SanityReport } from '../src/report/types'

const finding = (rule: string, severity: Finding['severity']): Finding => ({
  rule,
  severity,
  action: 'flag',
  dimension: 'validity',
  explanation: 'test',
})

const makeReport = (overrides: Partial<SanityReport> = {}): SanityReport => ({
  symbol: 'AAPL',
  source: 'test-source',
  sanity_score: 90,
  findings: [],
  summary: { critical: 0, warning: 0, info: 0 },
  generated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  at: '2026-01-01T00:00:00.000Z',
  symbol: 'AAPL',
  source: 'test-source',
  sanity_score: 90,
  summary: { critical: 0, warning: 0, info: 0 },
  rules: [],
  ...overrides,
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-history-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('historyEntryFromReport', () => {
  it('builds an entry from a report, deduping and sorting rule ids', () => {
    const report = makeReport({
      sanity_score: 45,
      summary: { critical: 1, warning: 1, info: 0 },
      findings: [
        finding('STALE_PRICE', 'warning'),
        finding('SPLIT_NOT_ADJUSTED', 'critical'),
        finding('STALE_PRICE', 'warning'),
      ],
    })
    expect(historyEntryFromReport(report)).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      symbol: 'AAPL',
      source: 'test-source',
      sanity_score: 45,
      summary: { critical: 1, warning: 1, info: 0 },
      rules: ['SPLIT_NOT_ADJUSTED', 'STALE_PRICE'],
    })
  })
})

describe('appendHistory + readHistory', () => {
  it('roundtrips entries and keeps one file per symbol', async () => {
    await appendHistory(dir, makeEntry({ symbol: 'AAPL', sanity_score: 91 }))
    await appendHistory(dir, makeEntry({ symbol: 'MSFT', sanity_score: 88 }))

    expect(await readHistory(dir, 'AAPL')).toHaveLength(1)
    expect(await readHistory(dir, 'MSFT')).toHaveLength(1)

    const aaplRaw = await readFile(join(dir, 'AAPL.jsonl'), 'utf8')
    const msftRaw = await readFile(join(dir, 'MSFT.jsonl'), 'utf8')
    expect(aaplRaw.trim().split('\n')).toHaveLength(1)
    expect(msftRaw.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(aaplRaw).symbol).toBe('AAPL')
    expect(JSON.parse(msftRaw).symbol).toBe('MSFT')
  })

  it('creates the directory recursively and returns the file path', async () => {
    const nested = join(dir, 'deep', 'nested')
    const filePath = await appendHistory(nested, makeEntry())
    expect(filePath).toBe(join(nested, 'AAPL.jsonl'))
    const raw = await readFile(filePath, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('returns entries most recent first', async () => {
    await appendHistory(dir, makeEntry({ at: '2026-01-01T00:00:00.000Z', sanity_score: 80 }))
    await appendHistory(dir, makeEntry({ at: '2026-01-02T00:00:00.000Z', sanity_score: 85 }))
    await appendHistory(dir, makeEntry({ at: '2026-01-03T00:00:00.000Z', sanity_score: 90 }))
    const entries = await readHistory(dir, 'AAPL')
    expect(entries.map((entry) => entry.sanity_score)).toEqual([90, 85, 80])
  })

  it('applies the limit and defaults to 20', async () => {
    for (let score = 0; score < 25; score++) {
      await appendHistory(dir, makeEntry({ sanity_score: score }))
    }
    expect(await readHistory(dir, 'AAPL')).toHaveLength(20)
    const limited = await readHistory(dir, 'AAPL', 3)
    expect(limited.map((entry) => entry.sanity_score)).toEqual([24, 23, 22])
  })

  it('returns an empty array when the file does not exist', async () => {
    expect(await readHistory(dir, 'NOPE')).toEqual([])
  })

  it('skips corrupt lines instead of failing', async () => {
    const goodOld = makeEntry({ at: '2026-01-01T00:00:00.000Z', sanity_score: 80 })
    const goodNew = makeEntry({ at: '2026-01-03T00:00:00.000Z', sanity_score: 90 })
    await writeFile(
      join(dir, 'AAPL.jsonl'),
      [
        JSON.stringify(goodOld),
        'this is not json',
        '{"symbol":"AAPL"}', // missing minimal fields
        JSON.stringify(goodNew),
        '',
      ].join('\n'),
      'utf8',
    )
    const entries = await readHistory(dir, 'AAPL')
    expect(entries.map((entry) => entry.sanity_score)).toEqual([90, 80])
  })

  it('sanitizes exotic symbols in the file name', async () => {
    const filePath = await appendHistory(dir, makeEntry({ symbol: 'BRK/B' }))
    expect(filePath).toBe(join(dir, 'BRK_B.jsonl'))
    expect(await readHistory(dir, 'BRK/B')).toHaveLength(1)
  })

  it('exposes the default history directory', () => {
    expect(DEFAULT_HISTORY_DIR).toBe('.mdsc/history')
  })
})

describe('formatHistory', () => {
  it('renders the table with an improving trend', () => {
    const output = formatHistory([
      makeEntry({ at: '2026-01-03T00:00:00.000Z', sanity_score: 92, rules: ['STALE_PRICE'] }),
      makeEntry({ at: '2026-01-01T00:00:00.000Z', sanity_score: 85 }),
    ])
    expect(output).toContain('DATE')
    expect(output).toContain('SCORE')
    expect(output).toContain('STALE_PRICE')
    expect(output).toContain('trend: 85 → 92 (improving)')
  })

  it('marks score moves within ±3 points as stable', () => {
    const output = formatHistory([makeEntry({ sanity_score: 92 }), makeEntry({ sanity_score: 90 })])
    expect(output).toContain('trend: 90 → 92 (stable)')
  })

  it('marks a clear drop as degrading', () => {
    const output = formatHistory([makeEntry({ sanity_score: 80 }), makeEntry({ sanity_score: 92 })])
    expect(output).toContain('trend: 92 → 80 (degrading)')
  })

  it('renders an empty history without crashing', () => {
    expect(formatHistory([])).toBe('no history entries')
  })
})
