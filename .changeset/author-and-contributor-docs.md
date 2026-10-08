---
"market-data-sanity-checker": patch
---

Rule references: `TS_DUPLICATED` now cites the incident it guards against (yfinance #765, duplicated 2021-07-09 rows for DRREDDY.NS and HINDPETRO.NS). Before, it and `TS_UNORDERED` cited yfinance #902, which is about a missing hourly bar. `TS_UNORDERED` now cites yfinance's own defensive re-sort, until a documented vendor incident is found. Package metadata: the author is now `pacocartones`. Contributor docs: a first-rule tutorial, an AI policy, and a private contact for conduct and security reports.
