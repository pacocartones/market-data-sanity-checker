# market-data-sanity-checker

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
