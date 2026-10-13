# market-data-sanity-checker

## 1.5.3

### Patch Changes

- 1a8912e: GitHub Action: by default a ref of the action now runs the exact npm version released with it, instead of the newest `1.x`. Set `version: 1` to keep following updates.

## 1.5.2

### Patch Changes

- 57f4bbb: `SERIES_TAIL_TRUNCATED` also cites the wrong-window regression shared in #35 (nobulex-registry `examples/wrong_window.py`), now pinned as three test cases: a matching window, a subject two sessions short, and a window with no shared session, which is `INSUFFICIENT_OVERLAP`, never a truncation. Thanks @arian-gogani.

## 1.5.1

### Patch Changes

- 2ea64d5: `mdsc history --limit` now rejects anything other than a whole number of at least 1 (for example `abc`, `0`, `-3` or `2.5`) with a clear message and exit code 2, instead of silently asking for `NaN` or a negative number of entries.

## 1.5.0

### Minor Changes

- 3da5a3b: `TS_UNORDERED` reports a series delivered entirely newest-first as one finding (its order, first and last date, bar count) instead of one per adjacent pair, so a reversed 250-bar series no longer produces 249 findings. It now cites a documented case: FX daily data that reached alpha_vantage users newest-first from 2020-02-03 (RomelTorres/alpha_vantage#186). Closes #58.

## 1.4.0

### Minor Changes

- ff88160: New compare rule `SERIES_TAIL_TRUNCATED` (warning): when one source ends two or more sessions before the other, `mdsc compare` now reports it and names the missing dates. A long enough overlap used to hide this case: `INSUFFICIENT_OVERLAP` stayed silent and `BAR_MISSING` only sees gaps between bars, so a series cut short at its end still read as agreement. A different start date is not reported, and neither is a single missing latest session. Reported in #35. The catalog is now 37 rules.
- cba43d5: `STALE_PRICE` no longer excuses every zero-volume run as a trading halt: a price frozen with volume 0 for more than `maxHaltSessions` (default 10, the longest summary suspension the SEC may order) is reported at `info`. Closes #59.

### Patch Changes

- 944a937: Connectors can now declare a daily request cap (`dailyRequestLimit`), and Alpha Vantage declares 25 for a free key (none with `ALPHA_VANTAGE_PREMIUM=true`). The weekly scoreboard stays under it: symbols over the cap are reported as skipped, not as failed, and the 20% quorum is judged on the symbols actually requested. Before this, the free key's 26th request onward was refused every week and 5 of 30 symbols counted as failures, one short of excluding the provider. The Alpha Vantage connector also stops telling you that a daily rate-limit Note "needs a premium key": only a premium-endpoint refusal gets that hint now.
- 3855fff: Rule references: `TS_DUPLICATED` now cites the incident it guards against (yfinance #765, duplicated 2021-07-09 rows for DRREDDY.NS and HINDPETRO.NS). Before, it and `TS_UNORDERED` cited yfinance #902, which is about a missing hourly bar. `TS_UNORDERED` now cites yfinance's own defensive re-sort, until a documented vendor incident is found. Package metadata: the author is now `pacocartones`. Contributor docs: a first-rule tutorial, an AI policy, and a private contact for conduct and security reports.
- b6a74f4: `mdsc rules` now prints the references of the compare rules too (they were in the catalog but not shown), and every one of the 36 rules cites at least one source: INSUFFICIENT_DATA, FUNDAMENTALS_SIGN_VALIDITY, SYMBOL_MISMATCH and INSUFFICIENT_OVERLAP gain references to the documented failures they guard against.
- 53d542d: The weekly provider scoreboard now lists the symbols skipped because a provider's daily request cap was reached.

## 1.3.0

### Minor Changes

- 1a2045a: Alpha Vantage works with a free key, and the supported Node.js range now matches the dependencies.
  
  - **Alpha Vantage connector:** uses the free `TIME_SERIES_DAILY` endpoint (latest 100 daily bars, unadjusted, no dividends or splits) by default. The adjusted endpoint with full history and corporate actions is premium-only on Alpha Vantage; set `ALPHA_VANTAGE_PREMIUM=true` with a premium key to use it. Previously every request with a free key failed with Alpha Vantage's "premium endpoint" message. A premium-only error now explains how to fix it.
  - **Node.js >= 22.12.** `commander` 15, a runtime dependency, requires it; `engines` said `>=20`, which Node 20 users could not rely on. CI tests Node 22 and 24.
  - **zod 4.** The exported schemas (`marketDataSetSchema`, `barSchema`, …) are zod 4 schemas. If you compose them with your own zod schemas, use zod 4.
  - **Errors keep their cause.** Errors rethrown by the rule engine, the compare engine and the CLI file loader now carry the original error as `cause`.
  - **Scoreboard:** a provider over the failure quorum is excluded and named instead of aborting the whole run.

## 1.2.0

### Minor Changes

- Dashboard v2 and user onboarding. The `--html` dashboard is now interactive while staying a single self-contained offline file: price chart with real axes, hover tooltips (date/OHLC/volume) and anomaly markers that scroll to their finding; severity filters; penalty breakdown explaining the score rule by rule; DAMA dimension chips; dataset-context header (date range, coverage, currency); compare overlay with axes and gap tooltips. Security posture kept: no external assets of any kind, all user data HTML-escaped, JSON payload serialized `<`-safe, static no-JS fallback remains fully readable. Docs: 30-second quickstart at the top of the README, new `docs/examples.md` with reproducible real-world cases (MOB.ST unadjusted split, Berkshire bad tick, GBX/GBP ×100, compare guards).

## 1.1.0

### Minor Changes

- v1.1.0 — the audit remediation. A 7-agent full-stack audit (code, security, tests/CI, SEO, AEO, UI/UX, financial-domain correctness) drove ~40 fixes and improvements:

  **Truth fixes (the trust layer never lies):** new guards `INSUFFICIENT_DATA` (empty/tiny datasets no longer score "reliable"), `SYMBOL_MISMATCH` and `INSUFFICIENT_OVERLAP` (comparisons over zero evidence no longer report "sources agree, 100/100"); `EXDATE_AFTER_PAYDATE` now honors FINRA 11140(b)(2) (large specials are ex-after-pay by mandate) downgraded to warning; `SPLIT_RATIO_IMPROBABLE` treats near-1 ratios as probable spin-offs (info) and cites real 20:1 splits; `SPLIT_NOT_ADJUSTED` uses relative tolerance (fires on noisy split days) with 20:1, 7:1 and reverse ratios added; `PRICE_SPIKE_INTRADAY` cites the real clearly-erroneous tiers (FINRA 11892); `RETURN_SPIKE` tiers severity by magnitude; `DIV_SCALE_100X` exempts specials to info; `PAYOUT_IMPOSSIBLE` raised to 300% (REIT-aware); `DIV_YIELD_IMPOSSIBLE` loses its absolute claim.

  **New rules (3):** `CORPORATE_ACTION_MISSING_FROM_FACTOR`, `FUNDAMENTALS_SIGN_VALIDITY`, `DIVIDEND_FX_MISMATCH`.

  **Platform hardening:** fetch timeouts (15s default, configurable); strict config (param keys validated, finite values, strict top-level); `--format` validated; flags validated before side effects; friendly file errors; coverage message ("N bars · M dividends · K splits checked"); `compare --files` basename sources; `only_in` dedup for same-named sources; `dateKey` normalization; transitive `sortedBars`; timestamp normalization (YYYYMMDD, epoch); papaparse error reporting; scoreboard quorum (refuses degraded runs); `prepack` build; engines >=20; dead code removed; CI matrix (ubuntu+windows × node 20/22).

  **Governance:** all actions SHA-pinned, least-privilege permissions, Dependabot, CodeQL, zizmor, SECURITY.md, release workflow with npm provenance, CSP meta in dashboards.

  **AEO/UX:** `llms.txt`, FAQ, "When NOT to use it", score formula documented, badges, TOC, compare HTML price overlay with divergence markers, corrected exit-code docs, SDK exports fixed (yahoo/alphaVantage now exported), maintainer docs moved to docs/maintainer/.

## 1.0.0

### Major Changes

- v1.0.0 — the complete trust layer. Phase 4: custom rules via `mdsc.config.json` (zod-validated, unknown rule ids fail loudly with the valid catalog), CI gating/alerts (`--fail-on <severity>` and `--min-score <n>` with informative exit codes), audit history (append-only JSONL per symbol, `mdsc history` with trend), self-contained HTML dashboards (`--html` — no server, no JS required, fully escaped, inline SVG gauge and price sparkline), and the provider scoreboard now emitting OKF/Frictionless data (`latest.csv` + `datapackage.json`). Ships 30 rules (25 single-source + 5 compare), 223 tests, calibration against 50 real Yahoo symbols with zero critical false positives, golden report-contract tests, and a weekly automated provider scoreboard.

## 0.3.0

### Minor Changes

- Phase 3: multi-source. Provider connectors as isolated plugins (Yahoo keyless; Alpha Vantage via ALPHA_VANTAGE_API_KEY), with pure, testable parsers (recorded real payloads). Comparison engine with 5 compare rules and consistency_score: CLOSE_DIVERGENCE, PRICE_DATE_MISMATCH, DIVIDEND_MISMATCH, SPLIT_MISMATCH, VOLUME_DIVERGENCE. CLI: `mdsc check --provider yahoo --symbol AAPL`, `mdsc compare --symbol X --providers a,b` (or --files), `mdsc providers`. Public provider scoreboard (weekly GitHub Action, reproducible with `pnpm scoreboard`) and calibration runner (`pnpm calibrate`). Calibration-driven refinements from auditing 50 real Yahoo symbols: RETURN_SPIKE gained an economic gate (|return| ≥ 4% besides the modified z-score), DIV_NOT_ADJUSTED now compares the factor deviation against the expected dividend adjustment, EXDATE_MISPLACED minimum expected drop raised to 2% — eliminating all false positives found on real data while keeping every true positive.

## 0.2.0

### Minor Changes

- Phase 2: corporate actions, fundamentals and metadata — 13 new rules (25 total). DIV_DUPLICATED (ALC.SW), EXDATE_MISPLACED (TETY.ST), DIV_NOT_ADJUSTED (8TRA.DE/1398.HK), DIV_SCALE_100X (HLCL.L/LTI.L pence-pounds), DIV_YIELD_IMPOSSIBLE, DIV_SPECIAL_MISCLASSIFIED, SPLIT_RATIO_IMPROBABLE, EXDATE_AFTER_PAYDATE, MARKETCAP_MISMATCH (Alphabet), PE_EPS_INCOMPATIBLE, PAYOUT_IMPOSSIBLE, CURRENCY_SUSPECT (GBX/GBP), SYMBOL_MAPPING_SUSPECT (ISIN checksum + country/exchange mismatch, ticker reuse). New optional `identifiers` schema field (ISIN/CUSIP/FIGI), time-series helpers with defensive chronology, golden report-contract tests over real-case fixtures, extended calibration guardian (zero findings on fully plausible data), and per-finding severity preservation in the engine (rules may deliberately degrade lighter sub-cases).

## 0.1.0

### Minor Changes

- Phase 1: rules engine with 12 OHLCV rules. Highlights: SPLIT_NOT_ADJUSTED (phantom −50% crashes from unadjusted splits, with causal hypothesis and volume evidence), PRICE_SPIKE_INTRADAY (isolated bad ticks, Berkshire-2024 style, with Hampel filter + reversal + clearly-erroneous deviation band), RETURN_SPIKE (modified z-score with semantic dedup against splits), currency scale suspects (GBX/GBP), staleness, gaps and structural checks. Shared statistical profile per dataset, per-rule config overrides (enable/disable, severity, params), `mdsc rules` catalog command, calibration guardian (zero critical false positives on plausible data) and universal robustness tests.
