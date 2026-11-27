# Calibration

Calibration runs the rule corpus on real market data to see how it behaves outside the synthetic
fixtures. This folder documents two outputs.

## `latest.json`: Yahoo only

Written by `pnpm calibrate`, and committed as evidence. It covers 50 liquid symbols (mega-cap tech,
dividend payers, financials, industrials and ETFs) over one year of Yahoo daily data. For each symbol
it records the sanity score, the bar count and the collapsed findings (one entry per rule, with the
date of its most severe occurrence and the total `occurrences`).

A finding in this file has a single source. It can be a real market move or a bad print from the
provider, and this file alone cannot tell which.

## `two-source.json`: Yahoo and Alpha Vantage

Written by `pnpm calibrate --two-source`, the check for the 1.9.0 milestone ("calibration against two
sources"). Nothing in this repository runs it automatically and it is not committed: the manually
dispatched workflow `.github/workflows/calibration.yml` runs it on main and uploads the file as the
`calibration-two-source` artifact. It needs `ALPHA_VANTAGE_API_KEY`.

### Inputs

- **24 symbols**, listed in `TWO_SOURCE_SYMBOLS` in `scripts/two-source-calibration.ts`: five each
  from tech, dividend payers, financials and ETFs, and four industrials, all from the 50-symbol list.
  Each symbol costs one Alpha Vantage request, so a run stays under the free key's 25 requests per
  day. The scoreboard uses the same key, so do not run both on the same UTC day. Symbols over the
  connector's `dailyRequestLimit()` are listed in `skipped` and are never requested. They do not count
  as failures.
- **Yahoo**: range `6mo` (about 125 sessions).
- **Alpha Vantage, free key**: `TIME_SERIES_DAILY` compact, the latest 100 unadjusted daily bars,
  with no dividends, no splits, no adjustment factors and no currency or exchange.

### What is compared

For each symbol the script:

1. runs every single-source rule on both series and keeps **each occurrence** with its date. It does
   not collapse them as the report does, because each date is compared on its own;
2. computes the **overlap**, the first and last session present in both series (inclusive);
3. runs the compare engine on the two series trimmed to the overlap. `DIVIDEND_MISMATCH` and
   `SPLIT_MISMATCH` are disabled (`disabled_compare_rules`): Alpha Vantage free reports no dividends
   or splits, so they would fire on every Yahoo corporate action;
4. classifies every Yahoo occurrence.

### Reading the classes

Checks are applied in this order. The first match decides the class.

| Class | When | Field |
| --- | --- | --- |
| `not_comparable` | The rule needs data that Alpha Vantage free does not provide (see below). | `reason: needs-dividends`, `needs-splits`, `needs-adjustment-factors`, `needs-fundamentals` or `needs-metadata` |
| `not_comparable` | The finding has no date (for example `INSUFFICIENT_DATA`). | `reason: no-date` |
| `not_comparable` | The date is outside the overlap, or the series do not overlap at all. | `reason: outside-overlap` |
| `corroborated` | The same rule fires on the Alpha Vantage series at the same date. | `basis: same-rule` |
| `corroborated` | The compare engine reports a disagreement at that date (for example `PRICE_DATE_MISMATCH`). | `basis: compare`, `by: <compare rule>` |
| `not_comparable` | Alpha Vantage has no bar at that date. | `reason: no-second-source-bar` |
| `not_comparable` | A different comparable rule fires on Alpha Vantage at that date, so its bar is not clean. | `reason: second-source-not-clean` |
| `contradicted` | Alpha Vantage has a clean bar at that date and the compare engine finds no disagreement there. | — |

How to read them:

- **corroborated**: the second provider sees the same thing, or the two providers disagree at that
  date. A corroborated return spike on both feeds is usually a real move. A spike with a compare
  disagreement is usually a bad print in one of the two feeds, and the compare finding says which
  values differ.
- **contradicted**: the second provider has an ordinary, agreeing bar at that date. These are the
  findings to review first as possible false positives. Some differences come from the inputs rather
  than from the rule: statistical rules (`RETURN_SPIKE`) compute their baseline on each series, and
  the Alpha Vantage series is shorter (100 sessions against about 125), so near a threshold one series
  can cross it and the other not.
- **not comparable**: this run cannot settle the finding. It is neither confirmed nor refuted.

### Not comparable by design: corporate actions

The Alpha Vantage free tier returns unadjusted prices with no dividends, splits or adjustment
factors. It also has no fundamentals and no currency, exchange or identifiers. Every rule that reads
that data is therefore `not_comparable`, whatever the second series shows (`NOT_COMPARABLE_RULES` in
`scripts/two-source-calibration.ts`):

- dividends: `DIV_DUPLICATED`, `EXDATE_AFTER_PAYDATE`, `EXDATE_MISPLACED`, `DIV_NOT_ADJUSTED`,
  `DIV_SCALE_100X`, `DIV_YIELD_IMPOSSIBLE`, `DIV_SPECIAL_MISCLASSIFIED`;
- splits: `SPLIT_RATIO_IMPROBABLE` and `SPLIT_NOT_ADJUSTED`. The second rule reads registered splits,
  and an unadjusted second series shows every real split as a jump, so agreement would mean nothing;
- adjustment factors: `CORPORATE_ACTION_MISSING_FROM_FACTOR`;
- fundamentals: `MARKETCAP_MISMATCH`, `PAYOUT_IMPOSSIBLE`, `PE_EPS_INCOMPATIBLE`,
  `FUNDAMENTALS_SIGN_VALIDITY`;
- metadata: `CURRENCY_SUSPECT`, `SYMBOL_MAPPING_SUSPECT`, `DIVIDEND_FX_MISMATCH`.

When the script decides whether an Alpha Vantage bar is clean, it ignores these rules on the Alpha
Vantage side. For example, `CURRENCY_SUSPECT` fires on every Alpha Vantage series because the free
tier has no currency. Checking corporate actions against a second source needs a premium key or
another provider.

### Shape

- `generated_at`, `mode` (`two-source`), `providers`, `alpha_vantage_tier`, `range`, `symbols`,
  `disabled_compare_rules`;
- `results[]`, one per compared symbol: `bars`, `sanity_score` (per provider), `overlap` (`from`,
  `to`, `sessions`, `yahoo_only`, `alpha_vantage_only`), `consistency_score`, `findings[]` (every
  Yahoo occurrence with `rule`, `severity`, `date`, `explanation`, `classification` and `basis`/`by`
  or `reason`), `alpha_vantage_findings[]` and `compare_findings[]`;
- `skipped[]` (`symbol`, `reason: daily-request-cap`) and `failed[]` (`symbol`, `provider`, `error`);
- `summary`: `symbols_compared`, `symbols_skipped`, `symbols_failed`, `totals`, and `by_rule` with
  `fired`, `corroborated`, `contradicted` and `not_comparable` for each Yahoo rule that fired.

Error text is the connectors' categorized message, never a raw provider body. The API key is removed
from every message and from the file before it is written.

No two-source run has been published yet. This folder will not show results until a maintainer runs
the workflow and reviews the artifact.
