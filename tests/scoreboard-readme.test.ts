import { describe, expect, it } from 'vitest'
import {
  renderScoreboardReadme,
  type ScoreboardComparison,
  type ScoreboardProviderResult,
} from '../src/scoreboard/readme'

const provider = (overrides: Partial<ScoreboardProviderResult> = {}): ScoreboardProviderResult => ({
  provider: 'yahoo',
  symbols_ok: 30,
  symbols_failed: 0,
  symbols_skipped: 0,
  mean_score: 91.2,
  min_score: 45,
  worst_symbols: [],
  total_findings: { critical: 1, warning: 11, info: 12 },
  ...overrides,
})

describe('renderScoreboardReadme', () => {
  it('lists skipped symbols in provider basket order without adding a line for other providers', () => {
    const readme = renderScoreboardReadme({
      generatedAt: '2026-10-13T00:00:00.000Z',
      basketSize: 4,
      providers: [
        provider(),
        provider({ provider: 'alpha-vantage', symbols_ok: 2, symbols_skipped: 2 }),
      ],
      excluded: [],
      skipped: [{ provider: 'alpha-vantage', symbols: ['GLD', 'TLT'] }],
      comparisons: [],
    })

    expect(readme).toContain('- alpha-vantage skipped (daily request cap): GLD, TLT')
    expect(readme).not.toContain('- yahoo skipped (daily request cap)')
    expect(readme.indexOf('GLD')).toBeLessThan(readme.indexOf('TLT'))
  })

  it('does not add skipped-symbol lines when no provider skipped symbols', () => {
    const readme = renderScoreboardReadme({
      generatedAt: '2026-10-13T00:00:00.000Z',
      basketSize: 1,
      providers: [provider()],
      excluded: [],
      skipped: [],
      comparisons: [],
    })

    expect(readme).not.toContain('daily request cap')
  })

  it('renders cross-provider consistency as a markdown table with findings and order preserved', () => {
    const comparisons: ScoreboardComparison[] = [
      {
        symbol: 'AAPL',
        consistency_score: 85,
        compared_dates: 99,
        findings: [
          {
            rule: 'DIVIDEND_MISMATCH',
            severity: 'warning',
            where: { date: '2025-11-10' },
          },
        ],
      },
      {
        symbol: 'MSFT',
        consistency_score: 80,
        compared_dates: 99,
        findings: [
          {
            rule: 'DIVIDEND_MISMATCH',
            severity: 'warning',
            where: { date: '2025-11-20' },
          },
          {
            rule: 'CLOSE_DIVERGENCE',
            severity: 'warning',
            where: { date: '2025-11-21' },
          },
        ],
      },
      {
        symbol: 'AMZN',
        consistency_score: 100,
        compared_dates: 99,
        findings: [],
      },
    ]

    const readme = renderScoreboardReadme({
      generatedAt: '2026-10-13T00:00:00.000Z',
      basketSize: 3,
      providers: [provider()],
      excluded: [],
      skipped: [],
      comparisons,
    })

    expect(readme).toContain('## Cross-provider consistency')
    expect(readme).not.toContain('```json')
    expect(readme).toContain('| Symbol | Consistency score | Compared dates | Findings |')
    expect(readme).toContain('|---|---|---|---|')
    expect(readme).toContain('| AAPL | 85 | 99 | DIVIDEND_MISMATCH (warning, 2025-11-10) |')
    expect(readme).toContain(
      '| MSFT | 80 | 99 | DIVIDEND_MISMATCH (warning, 2025-11-20); CLOSE_DIVERGENCE (warning, 2025-11-21) |',
    )
    expect(readme).toContain('| AMZN | 100 | 99 | none |')

    // Preserves order
    const aaplIndex = readme.indexOf('| AAPL |')
    const msftIndex = readme.indexOf('| MSFT |')
    const amznIndex = readme.indexOf('| AMZN |')
    expect(aaplIndex).toBeLessThan(msftIndex)
    expect(msftIndex).toBeLessThan(amznIndex)
  })

  it('omits cross-provider consistency section when comparisons is empty', () => {
    const readme = renderScoreboardReadme({
      generatedAt: '2026-10-13T00:00:00.000Z',
      basketSize: 1,
      providers: [provider()],
      excluded: [],
      skipped: [],
      comparisons: [],
    })

    expect(readme).not.toContain('## Cross-provider consistency')
  })
})
