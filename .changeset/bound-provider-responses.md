---
'market-data-sanity-checker': patch
---

Bound Alpha Vantage and Yahoo responses to 8 MiB and provider collections to 25,000 items before JSON parsing or traversal, rejecting oversized remote payloads instead of allowing them to exhaust the process.
