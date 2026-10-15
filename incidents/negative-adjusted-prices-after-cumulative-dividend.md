---
case: "Negative adjusted prices after cumulative dividend adjustments"
source: "Yahoo via yfinance"
reported_by: "@slapslash"
---

## What happened

Adjusting OHLC prices with `auto_adjust` produced negative prices (reported on FPE3.DE, HCHC, and ITRN); a commenter (silvavn) noted that Adj Close can drop below zero when a stock has paid many dividends.

## Evidence

[yfinance#138](https://github.com/ranaroussi/yfinance/issues/138)

## A checker should report

Read the precondition first: the Yahoo connector stores adjusted close as a ratio (`bar.adjustmentFactor = adjclose / close`, `src/connectors/yahoo.ts:128`) and leaves OHLC unadjusted, so `PRICE_NONPOSITIVE` (`src/rules/price/price-nonpositive.ts:31`) only sees negative values if they arrive in OHLC fields — such as a CSV or JSON file ingested from `auto_adjust` output where adjusted values replaced raw prices. When satisfied, `PRICE_NONPOSITIVE` flags any open, high, low or close that is zero, negative or not finite (rule P2, Barndorff-Nielsen et al., 2009), reporting `field` and `value` on the affected bar with `action: 'block'`.

## The check does NOT establish

That prices that remain positive after heavy adjustments are uncorrupted; a nonpositive price check only catches prices that crossed zero, not distortion or bias in positive adjusted prices.
