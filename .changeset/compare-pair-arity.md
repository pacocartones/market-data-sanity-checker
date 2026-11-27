---
"market-data-sanity-checker": patch
---

`mdsc compare` now rejects more than two `--files` or `--providers` entries and rejects using both modes together. Invalid input exits 2 before reading files, loading config or fetching providers, instead of silently ignoring extra values.
