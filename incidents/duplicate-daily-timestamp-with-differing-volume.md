---
case: "Duplicate daily timestamp with differing volume"
source: "Yahoo via yfinance"
reported_by: "@pratik-choudhari"
---

## What happened

The Yahoo chart API returned two daily rows for the same date with different volume values. yfinance users reported the duplicate for both `period='1d'` and explicit date ranges.

## Evidence

[yfinance#573](https://github.com/ranaroussi/yfinance/issues/573)

## A checker should report

`TS_DUPLICATED` fires when two or more bars share a timestamp. Since these rows have different volume values, the rule cannot determine which bar is final.

## The check does NOT establish

Which row is correct or which volume is accurate. Dropping the last row alone does not establish a correct repair.
