---
case: "Adjustment default changes across client versions"
source: "yfinance"
reported_by: "@arian-gogani"
---

## What happened

In yfinance 0.2.51, `download()` changed the default for `auto_adjust` to `True`. Users comparing output across versions reported changes to adjusted-close behavior and output columns. The project later merged a warning for callers that omit the argument.

## Evidence

[yfinance#2230](https://github.com/ranaroussi/yfinance/pull/2230), [#2214](https://github.com/ranaroussi/yfinance/issues/2214), [#2219](https://github.com/ranaroussi/yfinance/issues/2219), [#2198](https://github.com/ranaroussi/yfinance/issues/2198)

## A checker should report

When a caller has a prior snapshot, report a changed adjustment basis or output schema for the same symbol and requested window across client versions. `CLOSE_DIVERGENCE` compares two sources, so it does not cover a same-provider version change.

## The check does NOT establish

Which basis the caller intended. The default change was deliberate; a detected difference does not establish that either series is corrupted or that the adjusted arithmetic is wrong.
