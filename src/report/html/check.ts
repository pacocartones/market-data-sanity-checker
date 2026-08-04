/**
 * Single-dataset sanity report dashboard (v2).
 *
 * Static-first: the score gauge, penalty breakdown, finding cards and the
 * price chart (inline SVG with axes) all render without JavaScript. The
 * inline enhancement script layers tooltips, marker → card linking and
 * severity filters on top, fed by the #mdsc-data JSON blob.
 */

import type { Finding, SanityReport } from '../types'
import type { MarketDataSet } from '../../schema/market-data'
import { registry } from '../../rules/registry'
import {
  CHART,
  COLORS,
  FOOTER,
  MDSC_VERSION,
  REPO_URL,
  downsample,
  esc,
  findingMarksByDate,
  metaItem,
  page,
  payloadFindings,
  r2,
  renderDimensionChips,
  renderFilterBar,
  renderFindingCards,
  renderGauge,
  renderHoverZone,
  renderLegend,
  renderPenaltyBreakdown,
  renderSummaryChips,
  renderXTicks,
  renderYGridlines,
  xAt,
  yAt,
} from './shared'

/** Max points drawn and shipped to the JS payload; longer series are uniformly sampled. */
const CHART_MAX_POINTS = 600

/** Plottable bar: the payload shape ({ d, o, h, l, c, v? }) plus a sort key. */
interface PlotBar {
  d: string
  o: number
  h: number
  l: number
  c: number
  v?: number
}

/**
 * Main price chart: close line over the (downsampled) bars with a left price
 * axis, date ticks on the bottom, finding markers colored by severity and
 * diamonds for dividend/split ex-dates. The returned bars are exactly the
 * points drawn, so the JS tooltip can map a hover position to a bar by index.
 */
function renderPriceChart(
  dataset: MarketDataSet,
  findings: Finding[],
): { svg: string; bars: PlotBar[] } | null {
  const sorted = dataset.bars
    .filter((bar) => Number.isFinite(bar.close))
    .map((bar) => {
      const ts = Date.parse(bar.timestamp)
      const plot: PlotBar & { ts: number } = {
        d: bar.timestamp.slice(0, 10),
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        ts: Number.isNaN(ts) ? 0 : ts,
      }
      if (bar.volume !== undefined) plot.v = bar.volume
      return plot
    })
    .sort((a, b) => a.ts - b.ts)

  if (sorted.length === 0) return null

  const bars: PlotBar[] = downsample(sorted, CHART_MAX_POINTS).map(({ ts: _ts, ...bar }) => bar)
  const n = bars.length

  // Scale on the full high/low range so wicks and markers never clip.
  let min = Infinity
  let max = -Infinity
  for (const bar of bars) {
    if (Number.isFinite(bar.l) && bar.l < min) min = bar.l
    if (Number.isFinite(bar.h) && bar.h > max) max = bar.h
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = Math.min(...bars.map((b) => b.c))
    max = Math.max(...bars.map((b) => b.c))
  }
  if (min === max) {
    min -= 1
    max += 1
  }

  const marks = findingMarksByDate(findings)
  const polyline =
    n > 1
      ? `<polyline points="${bars.map((bar, i) => `${r2(xAt(i, n))},${r2(yAt(bar.c, min, max))}`).join(' ')}" fill="none" stroke="${COLORS.info}" stroke-width="1.5"/>`
      : ''

  // data-fi links the marker to its finding card (finding-<i>) via the inline JS.
  const markers = bars
    .map((bar, i) => {
      const mark = marks.get(bar.d)
      if (mark === undefined) return ''
      return `<circle cx="${r2(xAt(i, n))}" cy="${r2(yAt(bar.c, min, max))}" r="4.5" fill="${COLORS[mark.severity]}" stroke="#0d1117" stroke-width="1.5" data-fi="${mark.index}"><title>${esc(bar.d)}</title></circle>`
    })
    .filter((marker) => marker !== '')
    .join('\n')

  // A single bar cannot draw a line; show it as a dot.
  const single =
    n === 1
      ? `<circle cx="${r2(xAt(0, n))}" cy="${r2(yAt(bars[0]!.c, min, max))}" r="3" fill="${COLORS.info}" stroke="#0d1117" stroke-width="1.5"><title>${esc(bars[0]!.d)}</title></circle>`
      : ''

  // Corporate-action ex-dates as diamonds along the bottom of the plot area.
  const baseY = CHART.height - CHART.padB - 8
  const indexForDate = (date: string): number | null => {
    for (let i = 0; i < n; i++) {
      if (bars[i]!.d >= date) return i
    }
    return null
  }
  const diamond = (date: string, color: string, label: string): string => {
    const i = indexForDate(date)
    if (i === null) return ''
    const x = r2(xAt(i, n))
    return `<path d="M ${x} ${baseY - 4} L ${r2(xAt(i, n) + 4)} ${baseY} L ${x} ${baseY + 4} L ${r2(xAt(i, n) - 4)} ${baseY} Z" fill="${color}" stroke="#0d1117" stroke-width="1"><title>${esc(label)}</title></path>`
  }
  const dividends = (dataset.dividends ?? [])
    .map((div) => diamond(div.exDate.slice(0, 10), COLORS.warning, `dividend ${div.exDate.slice(0, 10)}: ${div.amount}`))
    .filter((d) => d !== '')
  const splits = (dataset.splits ?? [])
    .map((split) =>
      diamond(
        split.exDate.slice(0, 10),
        COLORS.suspicious,
        `split ${split.exDate.slice(0, 10)}: ${split.numerator}:${split.denominator}`,
      ),
    )
    .filter((d) => d !== '')

  const markCount = bars.filter((bar) => marks.has(bar.d)).length
  const pointWord = markCount === 1 ? 'point' : 'points'
  const aria = `Price chart, ${n} bars, ${markCount} flagged ${pointWord}`

  const legendItems = [
    `<li><span class="dot" style="background:${COLORS.info}"></span>close price</li>`,
    `<li><span class="dot" style="background:${COLORS.critical}"></span>${markCount} flagged ${pointWord} — click a marker to jump to its finding</li>`,
    dividends.length > 0
      ? `<li><span class="dot" style="background:${COLORS.warning}"></span>${dividends.length} dividend ex-date${dividends.length === 1 ? '' : 's'}</li>`
      : '',
    splits.length > 0
      ? `<li><span class="dot" style="background:${COLORS.suspicious}"></span>${splits.length} split ex-date${splits.length === 1 ? '' : 's'}</li>`
      : '',
  ]
    .filter((item) => item !== '')
    .join('\n')

  const svg = `<svg viewBox="0 0 ${CHART.width} ${CHART.height}" class="chart" id="mdsc-price-chart" role="img" aria-label="${esc(aria)}">
${renderYGridlines(min, max)}
${renderXTicks(bars.map((bar) => bar.d))}
${polyline}
${single}
${markers}
${dividends.join('\n')}
${splits.join('\n')}
${renderHoverZone()}
</svg>
<ul class="legend overlay-legend">
${legendItems}
</ul>`
  return { svg, bars }
}

/** Render a single-dataset sanity report as a self-contained HTML dashboard. */
export function renderCheckHtml(report: SanityReport, options: { dataset?: MarketDataSet } = {}): string {
  const dataset = options.dataset

  const coverage =
    dataset === undefined
      ? ''
      : metaItem(
          'coverage',
          `${dataset.bars.length} bars · ${dataset.dividends?.length ?? 0} dividends · ${dataset.splits?.length ?? 0} splits checked`,
        )
  const dates = dataset?.bars.map((bar) => bar.timestamp.slice(0, 10)).sort() ?? []
  const range =
    dates.length === 0 ? '' : metaItem('date range', `${dates[0]} → ${dates[dates.length - 1]}`)
  const currency =
    dataset?.currency === undefined ? '' : metaItem('currency', dataset.currency)

  const header = `<header class="card">
  <h1>${esc(report.symbol)} <span class="dim">· sanity report</span></h1>
  <div class="meta">
    ${metaItem('source', report.source)}
    ${metaItem('generated at', report.generated_at)}
    ${metaItem('tool', `market-data-sanity-checker v${MDSC_VERSION}`)}
    ${currency}
    ${coverage}
    ${range}
  </div>
  <div class="repo-link"><a href="${REPO_URL}" target="_blank" rel="noopener">github.com/pacocartones/market-data-sanity-checker</a></div>
</header>`

  const scoreCard = `<section class="card">
  <h2>Sanity score</h2>
  <div class="gauge-wrap">
    <div class="gauge">${renderGauge(report.sanity_score, 'sanity_score')}</div>
    ${renderLegend()}
    ${renderSummaryChips(report.summary)}
  </div>
  ${renderPenaltyBreakdown(report.findings)}
  ${renderDimensionChips(report.findings)}
</section>`

  const findingsCard =
    report.findings.length === 0
      ? `<section class="card"><p class="clean">No findings — this dataset passes all ${registry.length} plausibility rules.</p></section>`
      : `<section class="card" id="findings"><h2>Findings (${report.findings.length})</h2>${renderFilterBar(report.findings)}<div class="finding-cards">${renderFindingCards(report.findings)}</div></section>`

  const chart = dataset === undefined ? null : renderPriceChart(dataset, report.findings)
  const chartCard =
    chart === null
      ? ''
      : `<section class="card"><h2>Price chart — flagged points</h2>${chart.svg}<div id="mdsc-tooltip" class="tooltip mono" hidden></div></section>`

  const payload: Record<string, unknown> = {
    type: 'check',
    version: MDSC_VERSION,
    symbol: report.symbol,
    source: report.source,
    score: report.sanity_score,
    summary: report.summary,
    findings: payloadFindings(report.findings),
  }
  if (chart !== null && dataset !== undefined) {
    payload['bars'] = chart.bars
    payload['dividends'] = (dataset.dividends ?? []).map((div) => div.exDate.slice(0, 10))
    payload['splits'] = (dataset.splits ?? []).map((split) => split.exDate.slice(0, 10))
    payload['chart'] = { points: chart.bars.length }
    if (dataset.currency !== undefined) payload['currency'] = dataset.currency
  }

  return page(
    `${report.symbol} — sanity report`,
    [header, scoreCard, findingsCard, chartCard, FOOTER].filter((s) => s !== '').join('\n'),
    payload,
  )
}
