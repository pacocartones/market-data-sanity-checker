# Market-data incidents

A shared list of real cases where market data was wrong in a way a checker should catch.
One row per case. Each row says what a checker should report **and what that check does not
establish**, so a passing check is never read as more than it is.

Started in [#35](https://github.com/pacocartones/market-data-sanity-checker/issues/35). PRs
welcome: add a row, link the evidence, and keep the last two columns honest.

## Columns

- **Case**: a short name.
- **Source**: the provider, feed or tool where it happened (`any` when it is not provider-specific).
- **What happened**: the defect, in one or two sentences.
- **Evidence**: a public link (issue, post, fixture). No private data.
- **A checker should report**: the finding, with the rule if mdsc has one.
- **The check does NOT establish**: what a pass of that check still leaves open.
- **Reported by**: who brought the case.

## Cases

| Case | Source | What happened | Evidence | A checker should report | The check does NOT establish | Reported by |
| --- | --- | --- | --- | --- | --- | --- |
| Truncated tail passes a count-only comparison | any | A subject series ends two sessions before the authority. A comparison of session counts with a tolerance (10% in the original probe) passed with 2 of 21 sessions silently deleted. With equal counts but an entirely different window, a count comparison also passes. | [#35](https://github.com/pacocartones/market-data-sanity-checker/issues/35), [`wrong_window.py`](https://github.com/arian-gogani/nobulex-registry/blob/main/examples/wrong_window.py) | `SERIES_TAIL_TRUNCATED` naming the authority dates absent from the subject; with no shared session, `INSUFFICIENT_OVERLAP` (critical), never a truncation | That the shared sessions are correct: prices, adjustments and volumes need their own rules | @arian-gogani |
| Free endpoint serves unadjusted data after adjusted endpoint becomes paid | Alpha Vantage | The Python client reports that `TIME_SERIES_DAILY_ADJUSTED` is unavailable to free accounts. Its free `TIME_SERIES_DAILY` response is valid OHLCV, but has no adjusted close, dividends or splits. The connector documents this distinction at the pinned source revision. | [alpha_vantage#349](https://github.com/RomelTorres/alpha_vantage/issues/349), [`alphavantage.ts` at the reviewed revision](https://github.com/pacocartones/market-data-sanity-checker/blob/86ffa3af564704c0d5ec6ca7ae16c45c9b810a82/src/connectors/alphavantage.ts#L17-L20) | Report which endpoint or product tier was requested and served, and mark adjustment and corporate-action coverage unavailable when the requested adjusted endpoint was not served. The parser alone cannot infer a product downgrade from empty action lists. | That the raw prices are wrong. They may be correct unadjusted prices, and a missing action list by itself does not prove the symbol had an action. | @pacocartones, @arian-gogani |
| Adjustment default changes across client versions | yfinance | In yfinance 0.2.51, `download()` changed the default for `auto_adjust` to `True`. Users comparing output across versions reported changes to adjusted-close behavior and output columns. The project later merged a warning for callers that omit the argument. | [yfinance#2230](https://github.com/ranaroussi/yfinance/pull/2230), [#2214](https://github.com/ranaroussi/yfinance/issues/2214), [#2219](https://github.com/ranaroussi/yfinance/issues/2219), [#2198](https://github.com/ranaroussi/yfinance/issues/2198) | When a caller has a prior snapshot, report a changed adjustment basis or output schema for the same symbol and requested window across client versions. `CLOSE_DIVERGENCE` compares two sources, so it does not cover a same-provider version change. | Which basis the caller intended. The default change was deliberate; a detected difference does not establish that either series is corrupted or that the adjusted arithmetic is wrong. | @arian-gogani |
