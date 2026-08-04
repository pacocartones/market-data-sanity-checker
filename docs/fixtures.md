# Fixture catalog — real-world cases

Every fixture in [`tests/fixtures/`](../tests/fixtures/) reproduces a **documented
real-world data failure**, reduced to the smallest dataset that exhibits it. They are
the project's memory: each one anchors one or more rules to a case that actually
happened and cost someone money, time or trust. Each of the 13 real-case JSON
fixtures has a hand-reviewed golden report in [`tests/golden/`](../tests/golden/)
fixing the exact expected findings (see [`tests/golden.test.ts`](../tests/golden.test.ts)).

Adding a rule? Add its fixture first — the contract is: no real-world case, no rule.

## Price / OHLCV

| Fixture | Real case | Rules it anchors |
|---|---|---|
| `mob-st-unadjusted-split.json` | Yahoo logged MOB.ST's 2:1 split but never adjusted prior prices — a phantom −50% "crash" ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html)) | `SPLIT_NOT_ADJUSTED` |
| `berkshire-bad-tick.json` | 3-Jun-2024: a SIP software bug printed BRK.A at **$185.15** (~−99.97%); ~40 symbols affected, trades busted, IBKR lost $48M ([The Stack](https://www.thestack.technology/nyse-glitch-cause/)) | `PRICE_SPIKE_INTRADAY`, `RETURN_SPIKE` |
| `aet-l-currency-scale.json` | Yahoo switches London series between £ and pence **in blocks** inside the same series (AET.L) ([yfinance Price Repair](https://ranaroussi.github.io/yfinance/advanced/price_repair.html), [GBX/GBP](https://forum.portfolio-performance.info/t/stock-prices-in-pence-gbx/14270)) | `CURRENCY_SCALE_SUSPECT` |

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
| `bars-array.json` | Bare-array JSON ingestion; also anchors the degraded `CURRENCY_SUSPECT` info case (currency absent) |

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
