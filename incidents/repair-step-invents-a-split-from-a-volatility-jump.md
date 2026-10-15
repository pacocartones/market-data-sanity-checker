---
case: "Repair step invents a split from a volatility jump"
source: "Yahoo via yfinance"
reported_by: "@theXYZT"
---

## What happened

`yf.download('GME', period='max', repair=True)` flagged every row up to 2021-01-26 as `Repaired? True` (2021-01-26 close 147.98) and rows from 2021-01-27 as `False` (close 86.8775): the maintainer explains the repair took the jump on 2021-01-27 to mean Yahoo had not applied the 2022-07-22 stock split, so it scaled all earlier data by 4. A second report says NVDA before 2004-08-06 was scaled the same way, a real fall of about 3:2 taken for a split. The maintainer points to PR #2668 as the fix.

## Evidence

[yfinance#2660](https://github.com/ranaroussi/yfinance/issues/2660), [PR #2668](https://github.com/ranaroussi/yfinance/pull/2668)

## A checker should report

In single-source checking, `SPLIT_NOT_ADJUSTED` does not fire at the repair boundary (2021-01-26 to 2021-01-27): `matchSplitRatio` finds no common ratio for the −41.3% one-day move inside the 5% tolerance, so the rule moves on (`src/rules/price/split-not-adjusted.ts:58-59`). `RETURN_SPIKE` does fire and keeps its warning: the median and MAD of returns are computed once over the whole series (`buildDataProfile`, `src/rules/engine.ts:16-22`), so on a long history of ordinary daily moves a −41.3% return passes the 4% economic gate and the modified z-score gate at 3.5 — the z gate would only fail if the series' return MAD exceeded about 8% (0.6745 × 0.413 / 3.5) — and a move of at least 8% keeps full severity instead of dropping to `info` (`src/rules/price/return-spike.ts:84-97`). Comparing against the unrepaired series is what marks the boundary as artificial: `mdsc compare` emits **one** `CLOSE_DIVERGENCE` finding once the median daily divergence over shared dates exceeds 0.5%, and names only the worst date in `where` (`src/compare/rules/close-divergence.ts:47-56`) — the scaled years are not reported session by session.

## The check does NOT establish

That a repaired series passing the single-source rules is clean, nor that a flagged boundary is a defect: `RETURN_SPIKE` only says the day is statistically unexplained, and GME's genuine January-2021 moves raise the same warning. `CLOSE_DIVERGENCE` says two feeds disagree systematically and points at the worst date — not at the date range the repair touched, and not at which feed is right. Proving over-repair needs the corporate-action calendar (Yahoo logged the 2022-07-22 split) plus the raw stream or an independent venue.
