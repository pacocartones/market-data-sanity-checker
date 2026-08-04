/**
 * Two-source comparison report dashboard (v2).
 *
 * Same static-first contract as the check dashboard: the overlay chart
 * (inline SVG with axes), finding cards and score breakdown render without
 * JavaScript; the inline script adds the hover tooltip (both closes and the
 * % gap) and divergence marker → finding card linking.
 */

import type { MarketDataSet } from '../../schema/market-data'
import type { ComparisonReport } from '../../compare/comparator'
import { buildCompareContext } from '../../compare/engine'
import { compareRegistry } from '../../compare/registry'
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

/** Max points drawn per overlay and shipped to the JS payload. */
const OVERLAY_MAX_POINTS = 600

/**
 * Relative close gap above which a shared date counts as a divergence.
 * Matches the PRICE_DATE_MISMATCH default, computed inline so rendering
 * stays independent of the rule corpus.
 */
const OVERLAY_DIVERGENCE_PCT = 0.02

/** Aligned shared-date close pair: the payload point shape. */
export interface OverlayPoint {
  d: string
  a: number
  b: number
}

/**
 * Overlay of both close series over their shared dates, aligned exactly like
 * the compare engine (buildCompareContext). Both series share ONE global
 * min/max scale — normalizing each to its own range would hide the scale
 * divergences (e.g. one feed in cents) this chart exists to expose. Dates
 * whose relative close gap exceeds OVERLAY_DIVERGENCE_PCT get a red marker
 * linked to the matching finding card. Long series are uniformly sampled;
 * the marker count, extremes and aria-label all describe the sampled set
 * actually drawn, and the same points go into the JS payload for tooltips.
 */
function renderPriceOverlay(
  report: ComparisonReport,
  a: MarketDataSet,
  b: MarketDataSet,
): { svg: string; points: OverlayPoint[] } | null {
  const aligned: OverlayPoint[] = []
  for (const { date, a: barA, b: barB } of buildCompareContext(a, b).shared) {
    if (Number.isFinite(barA.close) && Number.isFinite(barB.close)) {
      aligned.push({ d: date, a: barA.close, b: barB.close })
    }
  }

  if (aligned.length === 0) return null

  const points = downsample(aligned, OVERLAY_MAX_POINTS)
  const n = points.length

  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (const p of points) {
    if (p.a < minA) minA = p.a
    if (p.a > maxA) maxA = p.a
    if (p.b < minB) minB = p.b
    if (p.b > maxB) maxB = p.b
  }
  const min = Math.min(minA, minB)
  const max = Math.max(maxA, maxB)

  const line = (key: 'a' | 'b', color: string): string =>
    `<polyline points="${points.map((p, i) => `${r2(xAt(i, n))},${r2(yAt(p[key], min, max))}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`

  // A single shared date cannot draw a line; show the two closes as dots.
  const series =
    n > 1
      ? `${line('a', COLORS.info)}\n${line('b', COLORS.ok)}`
      : [COLORS.info, COLORS.ok]
          .map(
            (color, k) =>
              `<circle cx="${r2(xAt(0, n))}" cy="${r2(yAt(k === 0 ? points[0]!.a : points[0]!.b, min, max))}" r="3" fill="${color}" stroke="#0d1117" stroke-width="1.5"><title>${esc(points[0]!.d)}</title></circle>`,
          )
          .join('\n')

  // data-fi links a divergence marker to the finding card for that date.
  const marks = findingMarksByDate(report.findings)
  const markers = points
    .map((p, i) => {
      const denom = Math.max(p.a, p.b)
      const rel = denom > 0 ? Math.abs(p.a - p.b) / denom : 0
      if (rel <= OVERLAY_DIVERGENCE_PCT) return ''
      const cy = (yAt(p.a, min, max) + yAt(p.b, min, max)) / 2
      const mark = marks.get(p.d)
      const link = mark === undefined ? '' : ` data-fi="${mark.index}"`
      return `<circle cx="${r2(xAt(i, n))}" cy="${r2(cy)}" r="4" fill="${COLORS.critical}" stroke="#0d1117" stroke-width="1.5"${link}><title>${esc(p.d)}: ${r2(p.a)} vs ${r2(p.b)} (${(rel * 100).toFixed(1)}% gap)</title></circle>`
    })
    .filter((marker) => marker !== '')

  const [labelA, labelB] = report.sources
  const legendItem = (label: string, color: string, lo: number, hi: number): string =>
    `<li><span class="dot" style="background:${color}"></span><span class="mono">${esc(label)}</span> <span class="mono dim">min ${r2(lo)} · max ${r2(hi)}</span></li>`
  const pointWord = markers.length === 1 ? 'point' : 'points'
  const aria = `Price overlay, ${n} shared date${n === 1 ? '' : 's'}, ${markers.length} divergence ${pointWord}`

  const svg = `<svg viewBox="0 0 ${CHART.width} ${CHART.height}" class="chart" id="mdsc-price-chart" role="img" aria-label="${esc(aria)}">
${renderYGridlines(min, max)}
${renderXTicks(points.map((p) => p.d))}
${series}
${markers.join('\n')}
${renderHoverZone()}
</svg>
<ul class="legend overlay-legend">
${legendItem(labelA, COLORS.info, minA, maxA)}
${legendItem(labelB, COLORS.ok, minB, maxB)}
<li><span class="dot" style="background:${COLORS.critical}"></span><span class="dim">${markers.length} divergence ${pointWord} (&gt;${OVERLAY_DIVERGENCE_PCT * 100}% close gap) — click a marker to jump to its finding</span></li>
</ul>`
  return { svg, points }
}

/**
 * Render a two-source comparison report as a self-contained HTML dashboard.
 * When both datasets are passed, a 'Price overlay' section plots the two
 * close series over their shared dates with divergence markers.
 */
export function renderCompareHtml(
  report: ComparisonReport,
  options: { a?: MarketDataSet; b?: MarketDataSet } = {},
): string {
  const [sourceA, sourceB] = report.sources
  const { a, b } = options

  const coverage =
    a === undefined || b === undefined
      ? ''
      : metaItem('coverage', `${a.bars.length} bars (${sourceA}) · ${b.bars.length} bars (${sourceB})`)

  const header = `<header class="card">
  <h1>${esc(report.symbol)} <span class="dim">· comparison report</span></h1>
  <div class="meta">
    ${metaItem('sources', `${sourceA} vs ${sourceB}`)}
    ${metaItem('generated at', report.generated_at)}
    ${metaItem('tool', `market-data-sanity-checker v${MDSC_VERSION}`)}
    ${coverage}
  </div>
  <div class="repo-link"><a href="${REPO_URL}" target="_blank" rel="noopener">github.com/pacocartones/market-data-sanity-checker</a></div>
</header>`

  const stats = [
    `<div class="stat"><div class="k">compared dates</div><div class="mono stat-v">${esc(report.compared_dates)}</div></div>`,
    ...Object.entries(report.only_in).map(
      ([source, count]) =>
        `<div class="stat"><div class="k">only in ${esc(source)}</div><div class="mono stat-v">${esc(count)}</div></div>`,
    ),
  ].join('\n')

  const scoreCard = `<section class="card">
  <h2>Consistency score</h2>
  <div class="gauge-wrap">
    <div class="gauge">${renderGauge(report.consistency_score, 'consistency_score')}</div>
    ${renderLegend()}
    ${renderSummaryChips(report.summary)}
  </div>
  ${renderPenaltyBreakdown(report.findings)}
  ${renderDimensionChips(report.findings)}
  <div class="stats">${stats}</div>
</section>`

  const findingsCard =
    report.findings.length === 0
      ? `<section class="card"><p class="clean">No findings — the two sources agree on all ${compareRegistry.length} comparison rules.</p></section>`
      : `<section class="card" id="findings"><h2>Findings (${report.findings.length})</h2>${renderFilterBar(report.findings)}<div class="finding-cards">${renderFindingCards(report.findings)}</div></section>`

  const overlay = a === undefined || b === undefined ? null : renderPriceOverlay(report, a, b)
  const overlayCard =
    overlay === null
      ? ''
      : `<section class="card"><h2>Price overlay</h2>${overlay.svg}<div id="mdsc-tooltip" class="tooltip mono" hidden></div></section>`

  const payload: Record<string, unknown> = {
    type: 'compare',
    version: MDSC_VERSION,
    symbol: report.symbol,
    sources: report.sources,
    score: report.consistency_score,
    summary: report.summary,
    compared_dates: report.compared_dates,
    findings: payloadFindings(report.findings),
  }
  if (overlay !== null) {
    payload['points'] = overlay.points
    payload['chart'] = { points: overlay.points.length }
  }

  return page(
    `${report.symbol} — comparison report`,
    [header, scoreCard, findingsCard, overlayCard, FOOTER].filter((s) => s !== '').join('\n'),
    payload,
  )
}
