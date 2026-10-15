---
case: "NaN OHLC prices with positive volume on completed session"
source: "Yahoo via yfinance"
reported_by: "@adrianwojcik"
---

## What happened

yf.download('ATR.WA') for a completed session (2026-07-09) returned all four OHLC prices as NaN with volume 6527; valid prices were backfilled by Yahoo later after the market opened.

## Evidence

[yfinance#2895](https://github.com/ranaroussi/yfinance/issues/2895), [#2925](https://github.com/ranaroussi/yfinance/issues/2925)

## A checker should report

If in-memory bars pass JS NaN values, `PRICE_NONPOSITIVE` flags all four fields because `Number.isFinite(NaN)` is false (`src/rules/price/price-nonpositive.ts:31`). However, through standard file ingestion paths, the bar fails schema validation before rules run: JSON `null` (representing NaN) is rejected by `barSchema`'s `z.number()` (`src/schema/market-data.ts:26-29`), and CSV empty cells are omitted by `parseOhlcvCsv` (`src/ingest/csv.ts:101-103`), failing required number schema checks.

## The check does NOT establish

That the session was actually traded or that the volume figure is accurate; conversely, non-finite or missing prices on a recently completed bar do not prove permanent data corruption, as upstream feeds like Yahoo may asynchronously backfill missing OHLC fields after market open.
