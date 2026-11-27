---
"market-data-sanity-checker": patch
---

Fix two rule details found in an audit. `mdsc rules` now describes `PAYOUT_IMPOSSIBLE` as "Payout ratio negative or above 300% of earnings", matching its default threshold; it used to say "far above 100%". Calling a rule's `check()` directly now returns the same recommended action that reports show for that severity (critical → block, warning → flag, info → review); some rules used to return a different one, for example `review` on a warning or `flag` on a critical. Reports from `mdsc check` and `mdsc compare` are unchanged.
