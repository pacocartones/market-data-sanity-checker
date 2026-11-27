---
case: "Intraday hourly timestamps shifted from exchange local time to UTC"
source: "Yahoo via yfinance"
reported_by: "@man-chan"
---

## What happened

Out of scope for MDSC, and the row says so up front: the README's "When NOT to use it" states that "The unit of analysis is the daily bar plus corporate actions; intraday streams and tick-level feeds are out of scope" (README, section "When NOT to use it"), and the Yahoo connector implements only `fetchDaily` (`src/connectors/yahoo.ts:185`, which hardcodes `interval=1d` at line 190; the `Connector` interface at `src/connectors/types.ts:136-150` declares no other fetch method). The row is kept as an intraday case on the precedent of the zero-volume 4-hour row. With yfinance 0.2.54, SPY hourly downloads for 2025-02-14 placed the regular session open at 14:30:00 where 0.1.69 returned 09:30:00 New York time, with zero-volume rows ahead of it. The report itself gives that shift; the UTC part, traced to yfinance standardizing `download()` timestamps to UTC across mixed exchanges, comes from dokson's later comment in the same issue, and the issue nowhere says timezone offsets were missing. The later fix (#2824) restores exchange-local timestamps for single-exchange downloads while mixed exchanges stay UTC, and the thread names `yf.Ticker('SPY').history()` as a workaround.

## Evidence

[yfinance#2327](https://github.com/ranaroussi/yfinance/issues/2327), [yfinance#2824](https://github.com/ranaroussi/yfinance/issues/2824)

## A checker should report

Read from the code, not run: this checkout has no toolchain, so the rule behaviour below is a code read. Nothing reaches a rule through the connector: `marketDate` (`src/connectors/yahoo.ts:57-59`) reduces every epoch to a calendar date using the exchange `gmtoffset`, so an hourly bar never becomes an MDSC bar. If an hourly file is ingested directly, `normalizeTimestamp` (`src/ingest/timestamps.ts:67-75`) returns the value unchanged because a timestamp carrying a time of day matches neither `COMPACT_DATE` (line 18) nor 10-digit `EPOCH_SECONDS` (line 21), and `timestampSchema` (`src/schema/market-data.ts:26-42`: the `ISO_DATE_OR_DATETIME` regex plus the calendar check in `isValidTimestamp`) accepts an ISO 8601 date with an optional time of day, offset or not, as long as the date part is a real calendar date and `Date.parse` reads the whole value, so hourly stamps such as `2025-02-14 14:30:00` or `2025-02-14T14:30:00+00:00` parse. `TS_UNORDERED` continues on every adjacent pair where `nextTime >= currentTime` (`src/rules/price/ts-unordered.ts:67`), so equal timestamps also pass and a uniform time shift leaves the series ordered: the rule emits nothing. `ZERO_VOLUME_MOVED` does fire on the zero-volume rows where `high != low` (`src/rules/price/zero-volume-moved.ts:31-33`), but it is not evidence of the shift: the same 610.50/609.22 bar exists unshifted at 04:00 in the correct 0.1.69 series, so it fires on good data too and says nothing about which timezone the stamps carry. All a single-source checker can say here is that the stamps carry a time of day; naming the timezone needs a second source or a session model.

## The check does NOT establish

That the timestamps correspond to actual exchange trading hours: a series that is internally consistent and monotonically ascending in UTC passes single-source temporal validation without a finding, and a zero-volume finding proves nothing about the shift because the same bar is present in the unshifted series. Detecting the shift needs `mdsc compare` against an independent intraday source or an explicit exchange-calendar session model, and MDSC ingests only daily bars, so neither check is in scope today.
