---
'market-data-sanity-checker': patch
---

Fix the CSV ingester rewriting ISO datetimes that carry a zone (e.g. `2024-01-02T14:30:00.123Z`): papaparse turned them into a `Date` and they came out as a locale-dependent `Date#toString` with the milliseconds lost, so bars that differed only by milliseconds became duplicates. Timestamps now stay verbatim.
