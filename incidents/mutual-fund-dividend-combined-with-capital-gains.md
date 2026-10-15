---
case: "Mutual fund dividend combined with capital gains distribution in single payout"
source: "Yahoo Finance via yfinance"
reported_by: "@rawmean"
---

## What happened

For mutual fund VWILX, the reporter found that Yahoo's `Dividends` entry on 2025-12-17 (7.857) combined both the ordinary income dividend (1.437) and a capital gains distribution (6.419, citing Vanguard fund figures), distorting downstream adjusted close calculations.

## Evidence

[yfinance#2666](https://github.com/ranaroussi/yfinance/issues/2666)

## A checker should report

Neither rule fires by default; this is read from the rule and connector code, not from running mdsc on this fund. `DIV_YIELD_IMPOSSIBLE` (`src/rules/corporate/div-yield-impossible.ts:38-40`) divides trailing 12-month regular dividends by the latest close and returns silently unless that ratio exceeds `maxAnnualYieldPct` (0.2, line 25); with VWILX at 105.82–112.24 on 2025-12-16 the 7.857 payout is a ~7% yield, far below that bound. `DIV_SPECIAL_MISCLASSIFIED` (`src/rules/corporate/div-special-misclassified.ts:48-64`) addresses capital-gains double counting in its header (citing the DODFX case), but cannot fire on Yahoo connector data because the connector never sets `type` on dividends (`src/connectors/yahoo.ts:141`) and reads only `events.dividends` and `events.splits`, so capital-gains events never reach the dataset (`src/connectors/yahoo.ts:135-155`), meaning the rule's untagged-dividend skip (`div-special-misclassified.ts:49`) always applies. On file ingestion where `type: 'regular'` is explicitly supplied, the rule still requires at least 4 regular peers in the prior 3 years (`minPeers: 4`, line 30; window `PEER_WINDOW_DAYS`, line 6; guard on line 63), a precondition the cited issue does not establish for this fund.

## The check does NOT establish

That a single-source price and dividend check can split an ordinary income dividend from a capital gain distribution; disentangling composite distribution components without issuer classification requires the fund issuer's official distribution schedule (such as Vanguard's published breakdown).
