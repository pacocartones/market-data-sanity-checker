---
case: "Temporary multi-symbol loss of split adjustment in adjusted close"
source: "Yahoo via yfinance"
reported_by: "@bruce1095"
---

## What happened

From Friday 2021-12-10, adjusted close for the symbols the reporter named as Apple, Nvidia and Tesla (start date 2018-01-01) "no longer reflect the stock splits", and the charts showed a steep decline on each split date; a commenter added that "the price is no longer adjusted to splits, and split info is missing". The reporter later confirmed that "the adjusted price issue has been fixed as of 12.14.2021", so the report covers a temporary window, 2021-12-10 to 2021-12-14, and the issue was closed as not planned in October 2022.

## Evidence

[yfinance#906](https://github.com/ranaroussi/yfinance/issues/906)

## A checker should report

Read the precondition first: `SPLIT_NOT_ADJUSTED` works on `close` only (`src/rules/price/split-not-adjusted.ts:55-58`), and the Yahoo connector stores adjusted close as a ratio, `bar.adjustmentFactor = adjclose / close` (`src/connectors/yahoo.ts:127-128`), which the rule never reads. So the incident is visible to the rule only when the adjusted series was ingested as `close` — a file whose close column carries adjusted values, or a snapshot taken that way. With that satisfied and no split metadata on the series, the rule matches the one-session drop against common split ratios (`matchSplitRatio`, line 58), finds no registered split inside the window (lines 62-66) and blocks. When the split list is present but the prices were never adjusted, `explained` is true and the rule stays silent; the report describes the other shape, split info missing along with the adjustment, which is the one the rule catches.

## The check does NOT establish

That the vendor's own fix reached the consumer: a database snapshot ingested during 2021-12-10 to 2021-12-14 keeps the broken split history after Yahoo corrects its side, and the rule's silence is equally consistent with an intact-but-unadjusted feed. Re-fetching the window and running `mdsc compare` against an independent provider is what turns "no finding" into evidence.
