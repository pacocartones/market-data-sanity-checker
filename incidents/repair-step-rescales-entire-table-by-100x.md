---
case: "Repair step rescales entire table by 100x and inverts repair flags"
source: "yfinance (synthetic reproduction on fixture frame)"
reported_by: "@lenamonj"
---

## What happened

In a synthetic reproduction calling yfinance's internal unit repair (`_fix_unit_switch`) on an in-memory fixture DataFrame without contacting Yahoo live, a single 100x scale anomaly in a GBp-quoted table caused the repair logic to propagate the 100× scaling across all 90 rows, returning every price 100× too large while inverting the `Repaired?` flags (marking broken rows unrepaired and clean rows repaired).

## Evidence

[yfinance#2924](https://github.com/ranaroussi/yfinance/issues/2924)

## A checker should report

`CURRENCY_SUSPECT` (`src/rules/metadata/currency-suspect.ts:58-61`) fires when the currency is explicitly `GBP`, the symbol ends in `.L`, and the median close is above 500 (the Yahoo connector fills `currency` from `meta.currency`, `src/connectors/yahoo.ts:163`), but goes silent on cheap stocks whose scaled median remains at or below 500. Meanwhile, `CURRENCY_SCALE_SUSPECT` (`src/rules/price/currency-scale-suspect.ts:37-104`) does NOT fire on a table that is uniformly 100× too large: the rule searches specifically for an internal step boundary where adjacent bars jump by ~100× confirmed by pre- and post-boundary window medians; when all rows are scaled uniformly, the ratio between consecutive bars remains ~1.0 with no internal boundary shift. Catching a whole-table scale error on cheap stocks requires instrument currency metadata or multi-source cross-checking (`mdsc compare`).

## The check does NOT establish

That the absolute price scale matches the instrument's official currency denomination (e.g. GBp pence vs GBP pounds) when the median price stays below 500 or when symbol/currency metadata is missing; a series that is uniformly wrong across its entirety possesses no internal contrast to detect with single-source price rules alone.
