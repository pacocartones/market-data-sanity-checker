import { describe, expect, it } from 'vitest'
import { MDSC_VERSION, renderCheckHtml, renderCompareHtml } from '../src/report/html'
import type { Finding, SanityReport } from '../src/report/types'
import type { ComparisonReport } from '../src/compare/comparator'
import type { MarketDataSet } from '../src/schema/market-data'

const findings: Finding[] = [
  {
    rule: 'RETURN_SPIKE',
    severity: 'critical',
    action: 'review',
    dimension: 'validity',
    where: { date: '2024-06-03' },
    explanation: 'Close moved -45.5% in one session with no corporate action to explain it.',
    evidence: { previous_close: 11, close: 6, return_pct: -45.45 },
    references: ['https://example.com/incidents/flash-crash'],
    occurrences: 3,
  },
  {
    rule: 'ZERO_VOLUME_MOVED',
    severity: 'warning',
    action: 'flag',
    dimension: 'validity',
    explanation: 'Price moved while reported volume was zero.',
  },
]

const report: SanityReport = {
  symbol: 'AAPL',
  source: 'yahoo',
  sanity_score: 45,
  findings,
  summary: { critical: 1, warning: 1, info: 0 },
  generated_at: '2024-06-05T00:00:00.000Z',
}

const dataset: MarketDataSet = {
  symbol: 'AAPL',
  source: 'yahoo',
  bars: [
    { timestamp: '2024-06-01', open: 10, high: 11, low: 9.5, close: 10 },
    { timestamp: '2024-06-02', open: 10, high: 12, low: 10, close: 11 },
    { timestamp: '2024-06-03', open: 11, high: 11, low: 5, close: 6 },
    { timestamp: '2024-06-04', open: 6, high: 7, low: 5.5, close: 6.5 },
  ],
}

const comparison: ComparisonReport = {
  symbol: 'AAPL',
  sources: ['yahoo', 'alphavantage'],
  consistency_score: 85,
  compared_dates: 248,
  only_in: { yahoo: 2, alphavantage: 0 },
  findings,
  summary: { critical: 1, warning: 1, info: 0 },
  generated_at: '2024-06-05T00:00:00.000Z',
}

/** Two sources sharing 3 dates; 2024-06-02 diverges by ~4.3% (>2% threshold). */
const compareA: MarketDataSet = {
  symbol: 'AAPL',
  source: 'yahoo',
  bars: [
    { timestamp: '2024-06-01', open: 10, high: 11, low: 9.5, close: 10 },
    { timestamp: '2024-06-02', open: 10, high: 12, low: 10, close: 11 },
    { timestamp: '2024-06-03', open: 11, high: 11, low: 10, close: 10.5 },
    { timestamp: '2024-06-04', open: 10, high: 11, low: 9, close: 10 },
  ],
}
const compareB: MarketDataSet = {
  symbol: 'AAPL',
  source: 'alphavantage',
  bars: [
    { timestamp: '2024-06-01', open: 10, high: 11, low: 9.5, close: 10 },
    { timestamp: '2024-06-02', open: 11, high: 12, low: 10.5, close: 11.5 },
    { timestamp: '2024-06-03', open: 11, high: 11, low: 10, close: 10.5 },
  ],
}
/** Same dates as compareA, all closes within a 1% gap — below the divergence threshold. */
const withinToleranceB: MarketDataSet = {
  ...compareB,
  bars: compareA.bars.map((bar) => ({ ...bar, close: bar.close * 1.01 })),
}

/**
 * v2 allows our own inline <script> blocks, so the check is now: no EXTERNAL
 * scripts, no <link>, and http(s) URLs only inside reference hrefs.
 */
const expectSelfContained = (html: string): void => {
  expect(html).not.toContain('<script src')
  expect(html).not.toContain('<link')
  const withoutHrefs = html.replace(/href="[^"]*"/g, '')
  expect(withoutHrefs).not.toContain('http://')
  expect(withoutHrefs).not.toContain('https://')
}

/** Extract the raw text of the embedded JSON payload. */
const extractPayload = (html: string): string => {
  const match = html.match(/<script type="application\/json" id="mdsc-data">([\s\S]*?)<\/script>/)
  expect(match, 'report must embed an #mdsc-data JSON blob').not.toBeNull()
  return match![1]!
}

describe('renderCheckHtml', () => {
  it('renders the score, rule ids, explanations and reference links', () => {
    const html = renderCheckHtml(report)
    expect(html).toContain('sanity_score')
    expect(html).toContain('>45</text>')
    expect(html).toContain('RETURN_SPIKE')
    expect(html).toContain('ZERO_VOLUME_MOVED')
    expect(html).toContain('Close moved -45.5%')
    expect(html).toContain('href="https://example.com/incidents/flash-crash"')
    expect(html).toContain('target="_blank" rel="noopener"')
    expect(html).toContain(`market-data-sanity-checker v${MDSC_VERSION}`)
  })

  it('renders where inline, occurrences and evidence in details', () => {
    const html = renderCheckHtml(report)
    expect(html).toContain('date=2024-06-03')
    expect(html).toContain('×3')
    expect(html).toContain('<details')
    expect(html).toContain('previous_close')
  })

  it('escapes a malicious symbol instead of injecting markup', () => {
    const html = renderCheckHtml({ ...report, symbol: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes a malicious explanation and source', () => {
    const evil: Finding = {
      rule: 'XSS_RULE',
      severity: 'info',
      action: 'flag',
      dimension: 'validity',
      explanation: '<img src=x onerror=alert(1)>',
    }
    const html = renderCheckHtml({ ...report, source: '"><script>alert(2)</script>', findings: [evil] })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<script>alert(2)</script>')
  })

  it('shows the clean message when there are no findings', () => {
    const html = renderCheckHtml({
      ...report,
      sanity_score: 100,
      findings: [],
      summary: { critical: 0, warning: 0, info: 0 },
    })
    expect(html).toMatch(/No findings — this dataset passes all \d+ plausibility rules\./)
    expect(html).not.toContain('<table')
  })

  it('renders a price chart with flagged points when a dataset is provided', () => {
    const html = renderCheckHtml(report, { dataset })
    expect(html).toContain('<svg')
    expect(html).toContain('<polyline')
    expect(html).toContain('<circle')
    // The flagged date 2024-06-03 gets a critical-colored marker.
    expect(html).toContain('#f85149')
  })

  it('omits the chart when no dataset is provided', () => {
    expect(renderCheckHtml(report)).not.toContain('<polyline')
  })

  it('does not turn non-http references into links', () => {
    const sneaky: Finding = { ...findings[0]!, references: ['javascript:alert(1)'] }
    const html = renderCheckHtml({ ...report, findings: [sneaky] })
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('javascript:alert(1)')
  })

  it('shows dataset context in the header when a dataset is provided', () => {
    const html = renderCheckHtml(report, { dataset })
    expect(html).toContain('4 bars · 0 dividends · 0 splits checked')
    expect(html).toContain('2024-06-01 → 2024-06-04')
    expect(html).toContain('href="https://github.com/pacocartones/market-data-sanity-checker"')
  })

  it('explains the score as a penalty breakdown from 100', () => {
    const html = renderCheckHtml(report)
    expect(html).toContain('How the score is built')
    // critical −40 then warning −15, ending at the report's score of 45.
    expect(html).toContain('−40')
    expect(html).toContain('−15')
    expect(html).toContain('final score <span class="mono">45</span>')
  })

  it('shows DAMA dimension chips with finding counts', () => {
    const html = renderCheckHtml(report)
    expect(html).toContain('validity 2')
    expect(html).toContain('completeness 0')
  })
})

describe('renderCompareHtml', () => {
  it('renders both sources, the consistency score and compared dates', () => {
    const html = renderCompareHtml(comparison)
    expect(html).toContain('yahoo vs alphavantage')
    expect(html).toContain('consistency_score')
    expect(html).toContain('>85</text>')
    expect(html).toContain('compared dates')
    expect(html).toContain('248')
    expect(html).toContain('only in yahoo')
  })

  it('shows the clean message when sources fully agree', () => {
    const html = renderCompareHtml({
      ...comparison,
      consistency_score: 100,
      findings: [],
      summary: { critical: 0, warning: 0, info: 0 },
    })
    expect(html).toMatch(/No findings — the two sources agree on all \d+ comparison rules\./)
  })

  it('renders the price overlay with two polylines and divergence markers when datasets are provided', () => {
    const html = renderCompareHtml(comparison, { a: compareA, b: compareB })
    expect(html).toContain('Price overlay')
    expect(html.match(/<polyline/g)).toHaveLength(2)
    expect(html).toContain('#58a6ff')
    expect(html).toContain('#3fb950')
    // Only 2024-06-02 diverges by more than 2%.
    expect(html.match(/<circle/g)).toHaveLength(1)
    expect(html).toContain('#f85149')
    expect(html).toContain('aria-label="Price overlay, 3 shared dates, 1 divergence point"')
    // Escaped source names in the legend, with per-series min/max labels.
    expect(html).toContain('>yahoo</span> <span class="mono dim">min 10 · max 11</span>')
    expect(html).toContain('>alphavantage</span> <span class="mono dim">min 10 · max 11.5</span>')
  })

  it('omits the overlay when no datasets are provided (backwards compatible)', () => {
    const html = renderCompareHtml(comparison)
    expect(html).not.toContain('Price overlay')
    expect(html).not.toContain('<polyline')
    expect(html).toContain('yahoo vs alphavantage')
    expect(html).toContain('consistency_score')
    expect(html).toContain('>85</text>')
  })

  it('draws no divergence markers when sources agree within tolerance', () => {
    const html = renderCompareHtml(comparison, { a: compareA, b: withinToleranceB })
    expect(html.match(/<polyline/g)).toHaveLength(2)
    expect(html).not.toContain('<circle')
    expect(html).toContain('aria-label="Price overlay, 4 shared dates, 0 divergence points"')
  })

  it('escapes a malicious source name in the overlay legend', () => {
    const evil: ComparisonReport = { ...comparison, sources: ['<script>alert(1)</script>', 'alphavantage'] }
    const html = renderCompareHtml(evil, { a: compareA, b: compareB })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('interactive v2 payload', () => {
  it('embeds the JSON blob and the fixed enhancement script', () => {
    const html = renderCheckHtml(report, { dataset })
    expect(html).toContain('id="mdsc-data"')
    expect(html).toContain('id="mdsc-tooltip"')
    expect(html).toContain("script-src 'unsafe-inline'")
    const payload = JSON.parse(extractPayload(html)) as { type: string; bars: unknown[] }
    expect(payload.type).toBe('check')
    expect(payload.bars).toHaveLength(4)
  })

  it('embeds the aligned shared-date series for compare reports', () => {
    const html = renderCompareHtml(comparison, { a: compareA, b: compareB })
    const payload = JSON.parse(extractPayload(html)) as { type: string; points: unknown[] }
    expect(payload.type).toBe('compare')
    expect(payload.points).toHaveLength(3)
  })

  it('never lets a corrupted datum close the script tag', () => {
    const evil: Finding = {
      rule: 'XSS_RULE',
      severity: 'critical',
      action: 'block',
      dimension: 'validity',
      explanation: '</script><script>alert(1)</script>',
    }
    const html = renderCheckHtml({ ...report, findings: [evil] }, { dataset })
    const blob = extractPayload(html)
    expect(blob).not.toContain('</script>')
    // No raw '<' survives serialization anywhere in the blob.
    expect(blob).not.toContain('<')
    // …yet the parsed payload preserves the original text.
    const payload = JSON.parse(blob) as { findings: Array<{ rule: string }> }
    expect(payload.findings[0]?.rule).toBe('XSS_RULE')
    // The static card shows the explanation escaped.
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('keeps findings fully visible in static markup (progressive enhancement)', () => {
    const html = renderCheckHtml(report, { dataset })
    // Cards with anchors exist statically; JS only adds filters and linking.
    expect(html).toContain('class="finding-card" id="finding-0"')
    expect(html).toContain('class="finding-card" id="finding-1"')
    expect(html).toContain('id="mdsc-filters"')
    expect(html).toContain('Close moved -45.5%')
    expect(html).toContain('Price moved while reported volume was zero.')
    // The action badge tells the user what to do with the flagged datum.
    expect(html).toContain('action-badge act-review')
    expect(html).toContain('action-badge act-flag')
  })

  it('links chart markers to their finding cards via data-fi', () => {
    const html = renderCheckHtml(report, { dataset })
    expect(html).toContain('data-fi="0"')
  })
})

describe('self-containment', () => {
  it('check report has no external assets and URLs only inside hrefs', () => {
    expectSelfContained(renderCheckHtml(report, { dataset }))
  })

  it('clean check report is also self-contained', () => {
    expectSelfContained(
      renderCheckHtml({ ...report, findings: [], summary: { critical: 0, warning: 0, info: 0 } }),
    )
  })

  it('compare report has no external assets and URLs only inside hrefs', () => {
    expectSelfContained(renderCompareHtml(comparison))
  })

  it('compare report with overlay has no external assets and URLs only inside hrefs', () => {
    expectSelfContained(renderCompareHtml(comparison, { a: compareA, b: compareB }))
  })
})
