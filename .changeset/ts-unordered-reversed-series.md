---
"market-data-sanity-checker": minor
---

`TS_UNORDERED` reports a series delivered entirely newest-first as one finding (its order, first and last date, bar count) instead of one per adjacent pair, so a reversed 250-bar series no longer produces 249 findings. It now cites a documented case: FX daily data that reached alpha_vantage users newest-first from 2020-02-03 (RomelTorres/alpha_vantage#186). Closes #58.
