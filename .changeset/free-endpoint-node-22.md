---
"market-data-sanity-checker": minor
---

Alpha Vantage works with a free key, and the supported Node.js range now matches the dependencies.

- **Alpha Vantage connector:** uses the free `TIME_SERIES_DAILY` endpoint (latest 100 daily bars, unadjusted, no dividends or splits) by default. The adjusted endpoint with full history and corporate actions is premium-only on Alpha Vantage; set `ALPHA_VANTAGE_PREMIUM=true` with a premium key to use it. Previously every request with a free key failed with Alpha Vantage's "premium endpoint" message. A premium-only error now explains how to fix it.
- **Node.js >= 22.12.** `commander` 15, a runtime dependency, requires it; `engines` said `>=20`, which Node 20 users could not rely on. CI tests Node 22 and 24.
- **zod 4.** The exported schemas (`marketDataSetSchema`, `barSchema`, …) are zod 4 schemas. If you compose them with your own zod schemas, use zod 4.
- **Errors keep their cause.** Errors rethrown by the rule engine, the compare engine and the CLI file loader now carry the original error as `cause`.
- **Scoreboard:** a provider over the failure quorum is excluded and named instead of aborting the whole run.
