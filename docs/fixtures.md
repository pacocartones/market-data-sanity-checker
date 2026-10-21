# Fixture catalog — real-world cases

Every fixture in [`tests/fixtures/`](../tests/fixtures/) reproduces a **documented
real-world data failure**, reduced to the smallest dataset that exhibits it. They are
the project's memory: each one anchors one or more rules to a case that actually
happened and cost someone money, time or trust. Each of the 17 real-case JSON
fixtures has a hand-reviewed golden report in [`tests/golden/`](../tests/golden/)
fixing the exact expected findings (see [`tests/golden.test.ts`](../tests/golden.test.ts)).
A fixture that is minimal by design carries fewer than ten bars, so its golden
also fixes the `INSUFFICIENT_DATA` warning from [`src/rules/price/insufficient-data.ts`](../src/rules/price/insufficient-data.ts)
(`minBars: 10`) — that finding is expected, not a regression, and it is why
`000020-ks-close-below-low.json`, a single bar, has two findings rather than one.

Adding a rule? Add its fixture first — the contract is: no real-world case, no rule.

## Price / OHLCV

| Fixture | Real case | Rules it anchors |
|---|---|---|
| `mob-st-unadjusted-split.json` | Yahoo logged MOB.ST's 2:1 split but never adjusted prior prices — a phantom −50% "crash" ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html)) | `SPLIT_NOT_ADJUSTED` |
| `berkshire-bad-tick.json` | 3-Jun-2024: a CTA SIP price-band issue triggered halts and BRK.A briefly showed a drop of about 99.9% ([The Stack](https://www.thestack.technology/nyse-glitch-cause/)); the fixture is a one-bar −99.97% drop (185.15) that reverts the next session | `PRICE_SPIKE_INTRADAY`, `RETURN_SPIKE` |
| `aet-l-currency-scale.json` | Yahoo switches London series between £ and pence **in blocks** inside the same series (AET.L) ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html), [GBX/GBP](https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270)) | `CURRENCY_SCALE_SUSPECT` |
| `ezj-l-gbx-to-gbp-switch.json` | EasyJet (London): permanent mid-series switch from pence to pounds on 22-Apr-2020; published prices, ticker inferred from company name ([yfinance#280](https://github.com/ranaroussi/yfinance/issues/280)) | `CURRENCY_SCALE_SUSPECT`, `SPLIT_NOT_ADJUSTED` |
| `000020-ks-close-below-low.json` | 000020.KS (15-Jan-2024): Yahoo adjusted close (9878.71) printed below low (9907.54), raw close (10280.0) below low (10310.0); TradingView reported O=10340, H=10430, L=10210, C=10280. The thread does not establish which provider is right; AAPL rounding noise (~1e-17) is excluded as non-defective ([yfinance#2857](https://github.com/ranaroussi/yfinance/issues/2857)) | `OHLC_INCONSISTENT` |
| `copec-sn-stale-price.json` | COPEC.SN (Santiago): frozen at the 2026-07-17 close (~6249.60 CLP) with volume 0 across following sessions after the exchange migration ([yfinance#2966](https://github.com/ranaroussi/yfinance/issues/2966)) | `STALE_PRICE` |
| `aapl-duplicated-daily-row.json` | AAPL, `history(period='1d')` on 29-Jan-2021: the last trading day returned twice, identical OHLC (135.830002 / 136.740005 / 130.210007 / 131.960007) and volumes 177180600 vs 177523812, straight from the reporter's screenshot; Yahoo prints 177523800 for that date today ([yfinance#573](https://github.com/ranaroussi/yfinance/issues/573)) | `TS_DUPLICATED` |

## Corporate actions

| Fixture | Real case | Rules it anchors |
|---|---|---|
| `alc-sw-duplicated-dividend.json` | ALC.SW: the same CHF 0.21 dividend recorded on both 9 and 10-May-2023 ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html)) | `DIV_DUPLICATED` |
| `tety-st-misplaced-exdate.json` | TETY.ST: dividend registered on a date with no price drop; the real drop arrives days later (ibid.) | `EXDATE_MISPLACED` |
| `8tra-de-not-adjusted.json` | 8TRA.DE / 1398.HK: dividend reported but `Adj Close = Close` before the ex-date (ibid.) | `DIV_NOT_ADJUSTED` |
| `hlcl-l-dividend-100x.json` | HLCL.L: dividend of 1.78 that should have been 0.0178 — pence recorded as pounds; also LTI.L (5150 → 51.5), BVT.L (ibid.) | `DIV_SCALE_100X`, `DIV_YIELD_IMPOSSIBLE` |
| `ge-reverse-split.json` | GE's legitimate 1-for-8 reverse split (2021), properly adjusted — the **negative control**: not every extreme event is an error ([GE press release](https://www.ge.com/news/press-releases/ge-announces-effective-date-for-reverse-stock-split)) | `SPLIT_RATIO_IMPROBABLE` (silence) |
| `missing-corp-action-factor.json` | Bars carry `adjustmentFactor` 0.97 with no dividend or split registered to explain it — the feed adjusted historical prices for an event it never recorded, the mirror image of `DIV_NOT_ADJUSTED` ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html)) | `CORPORATE_ACTION_MISSING_FROM_FACTOR` |

## Fundamentals

| Fixture | Real case | Rules it anchors |
|---|---|---|
| `googl-marketcap-mismatch.json` | Alphabet's market cap "totally wrong" on CNBC and inconsistent across Nasdaq/WSJ/Yahoo — share-count definitions and staleness ([Quant.SE #23085](https://quant.stackexchange.com/questions/23085/correct-alphabet-google-market-cap-calculation)) | `MARKETCAP_MISMATCH` |

## Metadata

| Fixture | Real case | Rules it anchors |
|---|---|---|
| `ab-ticker-isin-mismatch.json` | Ticker reuse: `AB` has named at least 6 different companies; an ISIN-US identity attributed to the LSE means the series splices two entities ([Crucible Research](https://www.crucible-research.com/nasdaq-100-historical-constituents), [AmiBroker forum](https://forum.amibroker.com/t/survivorship-bias-why-only-delisting-date/29543)) | `SYMBOL_MAPPING_SUSPECT` |
| `shell-l-dividend-fx.json` | SHEL.L trades in GBX (pence) but declares its dividend in USD — the real Shell/BP/HSBC case; applying the dividend in the price currency mixes scales and overstates yield ([GBX/GBP](https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270)) | `DIVIDEND_FX_MISMATCH` |

## Synthetic / structural

| Fixture | Purpose |
|---|---|
| `ohlcv-valid.csv` / `ohlcv-missing-columns.csv` | CSV ingestion contract (header aliases, required columns) |
| `ohlcv-zero-volume-moved.csv` | Runnable example for ZERO_VOLUME_MOVED (intraday price movement with zero volume) |
| `examples/example-authority.csv` / `examples/example-truncated.csv` | Runnable example for SERIES_TAIL_TRUNCATED (one source truncated early at its tail); synthetic made-up prices, no symbol, not real data for any ticker |
| `bars-array.json` | Bare-array JSON ingestion; also anchors the degraded `CURRENCY_SUSPECT` info case (currency absent) |
| `petr4-sa-dst-sunday-bar.json` | **Not real data.** A minimal synthetic reproduction of the shape described in yfinance [`fix_Yahoo_dst_issue`](https://github.com/ranaroussi/yfinance/blob/5cae563642b59f49adf6a04a5ad6744f8b0e084d/yfinance/utils.py#L902-L911) ("Yahoo has time off by few hours (e.g. Brazil 23:00 around Jan-2022)"): 24 invented ordinary Monday–Friday bars plus one Sunday-dated bar (`2022-01-09`). No price, volume or date was taken from PETR4.SA; the filename records the case it imitates, not its provenance. Anchors `BAR_ON_WEEKEND` with a golden that isolates it |

## Connector payloads

[`tests/fixtures/connectors/`](../tests/fixtures/connectors/) holds raw provider
payloads that anchor the connector **parsers** (via
[`tests/connectors-yahoo.test.ts`](../tests/connectors-yahoo.test.ts) and
[`tests/connectors-alphavantage.test.ts`](../tests/connectors-alphavantage.test.ts)).
They are not rule fixtures, so they have no golden reports.

| Payload | Origin | What it exercises |
|---|---|---|
| `yahoo-chart-aapl.json` | **Real** response recorded from the Yahoo chart API v8 (AAPL, `gmtoffset` −14400) | Chart-payload parsing into the canonical schema |
| `yahoo-chart-mob-st.json` | **Real** response recorded from the chart API v8 (MOB.ST, Stockholm, `gmtoffset` +7200) | Bar-date derivation with a European exchange `gmtoffset`, not plain UTC |
| `alphavantage-daily-ibm.json` | Representative payload faithful to the `TIME_SERIES_DAILY_ADJUSTED` format, built by hand — CI has no Alpha Vantage API key to record one | Alpha Vantage parsing without network access |
