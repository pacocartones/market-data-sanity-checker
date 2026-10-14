---
"market-data-sanity-checker": minor
---

`mdsc history` accepts `--format table|json` (default `table`), like `check`, `compare` and `rules`. With `--format json` it prints `{ "symbol": "...", "entries": [...] }`, where `entries` are the saved audit entries in the same order as the table (most recent first), and `{ "symbol": "...", "entries": [] }` (exit 0) when there is no history yet. An unknown format is rejected with exit code 2 before the history directory is read. Thanks @nova-loop.
