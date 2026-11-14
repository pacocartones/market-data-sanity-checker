import { describe, expect, it } from 'vitest'
import { escapeCell, escapeHeading, renderCompareMarkdown, renderReportMarkdown } from '../src/report/markdown'
import type { Finding, SanityReport } from '../src/report/types'
import type { ComparisonReport } from '../src/compare/comparator'

function reportWith(symbol: string, findings: Finding[] = []): SanityReport {
  return {
    symbol,
    source: 'yahoo',
    sanity_score: findings.length === 0 ? 100 : 55,
    findings,
    summary: { critical: 1, warning: 1, info: 0 },
    generated_at: '2026-10-15T00:00:00.000Z',
  }
}

describe('renderReportMarkdown', () => {
  it('renders report with findings as a markdown table with heading and escaped pipe cells', () => {
    const findings: Finding[] = [
      {
        rule: 'SPLIT_NOT_ADJUSTED',
        severity: 'critical',
        action: 'block',
        dimension: 'validity',
        where: { date: '2024-06-03' },
        explanation: 'Price dropped 50% | ratio 2:1 missing corporate action',
      },
      {
        rule: 'BAR_MISSING',
        severity: 'warning',
        action: 'flag',
        dimension: 'completeness',
        explanation: 'Missing trading week\nmulti-line explanation',
      },
    ]

    const report: SanityReport = {
      symbol: 'AAPL',
      source: 'yahoo',
      sanity_score: 55,
      findings,
      summary: { critical: 1, warning: 1, info: 0 },
      generated_at: '2026-10-15T00:00:00.000Z',
    }

    const md = renderReportMarkdown(report)

    expect(md).toContain('## AAPL (yahoo) — sanity_score: 55/100')
    expect(md).toContain('| Rule | Severity | Date | Explanation |')
    expect(md).toContain('|---|---|---|---|')
    expect(md).toContain('| SPLIT_NOT_ADJUSTED | critical | 2024-06-03 | Price dropped 50% \\| ratio 2:1 missing corporate action |')
    expect(md).toContain('| BAR_MISSING | warning | - | Missing trading week multi-line explanation |')
  })

  it('renders "No findings." when the findings list is empty', () => {
    const report: SanityReport = {
      symbol: 'MSFT',
      source: 'alpha-vantage',
      sanity_score: 100,
      findings: [],
      summary: { critical: 0, warning: 0, info: 0 },
      generated_at: '2026-10-15T00:00:00.000Z',
    }

    const md = renderReportMarkdown(report)

    expect(md).toContain('## MSFT (alpha-vantage) — sanity_score: 100/100')
    expect(md).toContain('No findings.')
    expect(md).not.toContain('| Rule | Severity | Date | Explanation |')
  })
})

describe('renderCompareMarkdown', () => {
  it('renders comparison report with findings as a markdown table with heading', () => {
    const findings: Finding[] = [
      {
        rule: 'CLOSE_DIVERGENCE',
        severity: 'warning',
        action: 'flag',
        dimension: 'consistency',
        where: { date: '2024-06-03' },
        explanation: 'Close diverges by 4.5% (yahoo: 100 | alphavantage: 104.5)',
      },
    ]

    const report: ComparisonReport = {
      symbol: 'AAPL',
      sources: ['yahoo', 'alphavantage'],
      consistency_score: 85,
      compared_dates: 248,
      only_in: { yahoo: 2, alphavantage: 0 },
      findings,
      summary: { critical: 0, warning: 1, info: 0 },
      generated_at: '2026-10-15T00:00:00.000Z',
    }

    const md = renderCompareMarkdown(report)

    expect(md).toContain('## AAPL — yahoo vs alphavantage — consistency_score: 85/100')
    expect(md).toContain('| Rule | Severity | Date | Explanation |')
    expect(md).toContain('|---|---|---|---|')
    expect(md).toContain('| CLOSE_DIVERGENCE | warning | 2024-06-03 | Close diverges by 4.5% (yahoo: 100 \\| alphavantage: 104.5) |')
  })

  it('renders "No findings." when comparison findings list is empty', () => {
    const report: ComparisonReport = {
      symbol: 'GOOGL',
      sources: ['yahoo', 'polygon'],
      consistency_score: 100,
      compared_dates: 100,
      only_in: { yahoo: 0, polygon: 0 },
      findings: [],
      summary: { critical: 0, warning: 0, info: 0 },
      generated_at: '2026-10-15T00:00:00.000Z',
    }

    const md = renderCompareMarkdown(report)

    expect(md).toContain('## GOOGL — yahoo vs polygon — consistency_score: 100/100')
    expect(md).toContain('No findings.')
    expect(md).not.toContain('| Rule | Severity | Date | Explanation |')
  })
})

describe('escapeCell', () => {
  it('escapes pipes and replaces newlines with spaces', () => {
    expect(escapeCell('hello|world')).toBe('hello\\|world')
    expect(escapeCell('line 1\nline 2\r\nline 3')).toBe('line 1 line 2 line 3')
  })

  it('doubles the backslash first, so a value ending in one cannot eat the pipe escape', () => {
    expect(escapeCell('C:\\path')).toBe('C:\\\\path')
    expect(escapeCell('a\\')).toBe('a\\\\')
    expect(escapeCell('a\\|b')).toBe('a\\\\\\|b')
  })

  it('keeps a row that ends a cell on a backslash inside its four columns', () => {
    const md = renderReportMarkdown(
      reportWith('AAPL', [
        {
          rule: 'BAR_MISSING',
          severity: 'info',
          action: 'flag',
          dimension: 'completeness',
          explanation: 'trailing backslash \\ ends the value',
        },
      ]),
    )
    const row = md.split('\n').find((line) => line.startsWith('| BAR_MISSING'))
    expect(row).toBe('| BAR_MISSING | info | - | trailing backslash \\\\ ends the value |')
    expect(row?.match(/(?<!\\)\|/g)).toHaveLength(5)
  })
})

describe('escapeHeading', () => {
  it('leaves a plain value alone', () => {
    expect(escapeHeading('AAPL')).toBe('AAPL')
    expect(escapeHeading('yahoo')).toBe('yahoo')
  })

  it('collapses every line break to one space', () => {
    expect(escapeHeading('AAPL\n\nx')).toBe('AAPL x')
    expect(escapeHeading('AAPL\r\r\nx')).toBe('AAPL x')
  })

  it('escapes the markdown and html characters that can start a construct', () => {
    expect(escapeHeading('[x](y) <i> & `z` * _ |')).toBe('\\[x\\](y) \\<i\\> \\& \\`z\\` \\* \\_ \\|')
  })

  it('doubles the backslash before adding escapes', () => {
    // a literal backslash must not become the escape of the character after it
    expect(escapeHeading('a\\[b')).toBe('a\\\\\\[b')
  })

  it('preserves legitimate Unicode format characters and joined emoji', () => {
    const text = 'A\u200bB\u200cC\u200dD\u2060E 👩‍💻'
    expect(escapeCell(text)).toBe(text)
    expect(escapeHeading(text)).toBe(text)
  })
})

describe('heading injection', () => {
  // The reproduction from the review of #200: the symbol can come from --symbol or
  // from the data file, so whoever controls it used to control the markdown.
  const hostile = 'AAPL\n\n[free prize](https://evil.example) <img src=x onerror=alert(1)>'

  it('keeps a hostile symbol inside the heading instead of emitting a live link or tag', () => {
    const md = renderReportMarkdown(reportWith(hostile))
    const lines = md.split('\n')
    expect(lines[0]).toBe('## AAPL \\[free prize\\](https://evil.example) \\<img src=x onerror=alert(1)\\> (yahoo) — sanity_score: 100/100')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('No findings.')
    expect(md).not.toContain('\n\n[free prize]')
    // no angle bracket left unescaped: nothing here can open an html tag
    expect(/(^|[^\\])</.test(lines[0] ?? '')).toBe(false)
  })

  it('escapes an injected source the same way', () => {
    const report = { ...reportWith('AAPL'), source: 'yah\n# owned\n*bold*' }
    expect(renderReportMarkdown(report).split('\n')[0]).toBe('## AAPL (yah # owned \\*bold\\*) — sanity_score: 100/100')
  })

  it('escapes both compare sources and the compare symbol', () => {
    const report: ComparisonReport = {
      symbol: 'AAPL\n\n- ignored',
      sources: ['yahoo](https://evil.example)', 'poly\nding'],
      consistency_score: 100,
      compared_dates: 10,
      only_in: { yahoo: 0, polygon: 0 },
      findings: [],
      summary: { critical: 0, warning: 0, info: 0 },
      generated_at: '2026-10-15T00:00:00.000Z',
    }
    const md = renderCompareMarkdown(report)
    expect(md.split('\n')[0]).toBe('## AAPL - ignored — yahoo\\](https://evil.example) vs poly ding — consistency_score: 100/100')
    expect(md.split('\n')).toHaveLength(3)
  })
})
