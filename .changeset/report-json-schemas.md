---
'market-data-sanity-checker': minor
---

Publish versioned JSON Schemas (draft 2020-12) for the JSON output of `mdsc check --format json` and `mdsc compare --format json`. They ship in the package as `schemas/check-report.v1.json` and `schemas/compare-report.v1.json`, with `$id`s under `https://pacocartones.github.io/market-data-sanity-checker/schemas/`. `mdsc schema check` and `mdsc schema compare` print them, and the zod schemas they are generated from are exported as `checkReportSchema` and `compareReportSchema`. The JSON output itself does not change: the v1 schemas describe the 1.x output, and a breaking change to it would come with a v2 schema and a major version.
