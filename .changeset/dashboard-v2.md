---
"market-data-sanity-checker": minor
---

Dashboard v2 and user onboarding. The `--html` dashboard is now interactive while staying a single self-contained offline file: price chart with real axes, hover tooltips (date/OHLC/volume) and anomaly markers that scroll to their finding; severity filters; penalty breakdown explaining the score rule by rule; DAMA dimension chips; dataset-context header (date range, coverage, currency); compare overlay with axes and gap tooltips. Security posture kept: no external assets of any kind, all user data HTML-escaped, JSON payload serialized `<`-safe, static no-JS fallback remains fully readable. Docs: 30-second quickstart at the top of the README, new `docs/examples.md` with reproducible real-world cases (MOB.ST unadjusted split, Berkshire bad tick, GBX/GBP ×100, compare guards).
