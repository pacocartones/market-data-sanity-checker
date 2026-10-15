---
case: "Zero-volume 4-hour bars coming from the upstream feed"
source: "Yahoo via yfinance"
reported_by: "@krydazo"
---

## What happened

`yf.download(tickers='BTC-USD', period='1y', interval='4h')` returned `Volume` 0 in about half of the rows, with no pattern the reporter could identify, and the Yahoo Finance site did not let them check intraday intervals. Another user traced it to Yahoo's raw `/v8/finance/chart/BTC-USD` JSON, whose `volume` array carries explicit `0` and `null` entries at those timestamps. yfinance closed the issue as `not_planned` and referred to its price-repair documentation.

## Evidence

[yfinance#2686](https://github.com/ranaroussi/yfinance/issues/2686), [price repair notes](https://ranaroussi.github.io/yfinance/advanced/price_repair.html)

## A checker should report

Out of scope for MDSC, and the row should say so: the unit of analysis is the daily bar, intraday streams are not read (`README.md`, "When NOT to use it"). The daily equivalent is `ZERO_VOLUME_MOVED` (warning), which flags a bar with `volume === 0` and `high != low` (`src/rules/price/zero-volume-moved.ts:31-33`) and stays silent when `high == low`, because flat prices with zero volume are not a contradiction. Aggregation also hides the case above: at daily resolution the session is one bar, and unless that daily bar itself reports zero volume while its high differs from its low, zeros inside the day never reach the rule.

## The check does NOT establish

Whether a zero-volume bar is genuine inactivity, a halt or an upstream omission; the rule's own comment cites 1COV.DE as a documented corrupt vendor row and tells the user to verify against the source. Diagnosing the intraday case needs the feed at 4-hour resolution, which MDSC does not ingest.
