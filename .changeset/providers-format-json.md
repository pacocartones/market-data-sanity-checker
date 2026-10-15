---
'market-data-sanity-checker': minor
---

Add `--format table|json` to `mdsc providers`. The JSON output is an array of `{ name, available, requires, daily_request_limit }`, where `daily_request_limit` is the provider's daily request cap with the current credentials (25 for an Alpha Vantage free key) or `null` when it has none. The table now shows the cap after `ready`, e.g. `alpha-vantage    ready · 25 requests/day`. `connectorStatus()` also returns `dailyRequestLimit`.
