---
case: "Dividend 28x the share price breaking history repair"
source: "Yahoo via yfinance"
reported_by: "@KIC"
---

## What happened

For `Ticker('ENV.CR').history(period='max')`, the maintainer explained that price repair cannot work because in December 2013 Close was 0.000008 on consecutive days while Dividends was 0.000226 on 2013-12-12 (about 28x the prior day's close).

## Evidence

[yfinance#2890](https://github.com/ranaroussi/yfinance/issues/2890)

## A checker should report

`DIV_SCALE_100X` (`src/rules/corporate/div-scale-100x.ts:24`) emits a warning whenever a single payment yield exceeds `maxSingleYieldPct` (25%, line 29), so it flags the 2013-12-12 dividend (about 28x the prior close) across historical data — though its rule description hypothesis (a ÷100 pence/pounds scale error) does not fit this penny-stock case. Conversely, `DIV_YIELD_IMPOSSIBLE` (`src/rules/corporate/div-yield-impossible.ts:34-40`) measures trailing 12-month regular dividends against the latest close of the series, so on a full history ending in 2026 it does not see the 2013 event. Non-finite or NaN OHLC prices from Yahoo do not reach `PRICE_NONPOSITIVE` through the Yahoo connector: the parser skips bars with non-finite prices directly (`src/connectors/yahoo.ts:114-123`).

## The check does NOT establish

That prices like 0.000008 represent the true economic share value rather than an unmodeled currency or scaling artifact, and a trailing-12-month yield rule bounded to the latest bar says nothing about corporate action anomalies deep in historical data.
