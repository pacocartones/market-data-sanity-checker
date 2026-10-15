---
case: "Phantom price drop without corporate action"
source: "Yahoo Finance via yfinance"
reported_by: "@sahilpurav"
---

## What happened

For RAYMOND.NS on 2025-05-14, the daily close dropped from 1564.30 to 551.20 without any split, bonus or demerger registered on the exchange.

## Evidence

[yfinance#2519](https://github.com/ranaroussi/yfinance/issues/2519)

## A checker should report

`RETURN_SPIKE` flags the -64.8% single-day drop because it easily exceeds the default economic gate (4%) and full severity cap (8% or z-score >= 5). `SPLIT_NOT_ADJUSTED` does not apply because the ratio 1564.30 / 551.20 (~2.84) does not match any common integer split ratio.

## The check does NOT establish

That the new price is objectively wrong and the prior price was right; a spike check only flags that the move is an unexplained statistical outlier. Validating the true market close requires cross-checking external venue feeds such as NSE or TradingView.
