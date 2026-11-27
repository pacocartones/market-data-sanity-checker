---
case: "Weekly and monthly bars adjusted for a mid-period dividend too early"
source: "Yahoo via yfinance"
reported_by: "@ValueRaider"
---

## What happened

While daily data for I3E.L around the 2022-11-10 dividend of 0.1425 kept close and adjusted close equal at 23.5 on 2022-11-10 and 2022-11-11, the weekly bar dated 2022-11-07 reported Close 23.5 against Adj Close 23.357803, adjusting that week's close — which is the last daily close of the week — for an event in mid-week. The issue adds that monthly bars were affected the same way, and the maintainer notes that `repair=True` fixes it.

## Evidence

[yfinance#1273](https://github.com/ranaroussi/yfinance/issues/1273)

## A checker should report

Weekly and monthly bars are outside mdsc's daily unit of analysis (README, section "When NOT to use it"), so single-source checking does not reach this case; the route that does apply is `mdsc compare` against another source, which aligns two series by calendar date (`dateKey` and `buildCompareContext`, `src/compare/engine.ts:26-56`) and emits one `CLOSE_DIVERGENCE` finding when the median divergence of `close` across at least 10 shared dates exceeds 0.5%, naming only the worst date (`src/compare/rules/close-divergence.ts:31-47`; reads `close` only, line 41). By reading the rules on the daily series — not run here — the Yahoo connector stores adjusted close as a ratio, `bar.adjustmentFactor = adjclose / close` (`src/connectors/yahoo.ts:137`), and `DIV_NOT_ADJUSTED` (`src/rules/corporate/div-not-adjusted.ts:50-110`) fires when the observed adjustment (1 minus the median factor of the bars sampled strictly before the ex-date bar, lines 74-79) falls below `underAdjustmentRatio` (default 0.5) times `dividend / previousClose` (lines 70, 82-84): an under-adjustment test, not a test for prices that completely lack adjustment. Here the daily adjustment is present, so the under-adjustment condition is not met and the rule stays silent — that conclusion is @pacocartones's review reading, since the issue itself documents only the 2022-11-10 and 2022-11-11 closes while the rule samples the sessions strictly before the ex-date bar (lines 74-79). `CORPORATE_ACTION_MISSING_FROM_FACTOR` (`src/rules/corporate/corp-action-missing-from-factor.ts:34-101`) audits only the bars after the last registered event for lingering factors below 1 (lines 56-71). Neither rule compares an aggregated bar against the daily bars it was built from.

## The check does NOT establish

That a weekly or monthly bar from one source agrees with the last daily close of the week, nor which feed is right: `mdsc compare` says two feeds disagree on `close` systematically and names the worst date, not the interval the aggregator adjusted too early.
