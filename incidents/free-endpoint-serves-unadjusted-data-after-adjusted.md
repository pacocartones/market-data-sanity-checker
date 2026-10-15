---
case: "Free endpoint serves unadjusted data after adjusted endpoint becomes paid"
source: "Alpha Vantage"
reported_by: "@pacocartones, @arian-gogani"
---

## What happened

The Python client reports that `TIME_SERIES_DAILY_ADJUSTED` is unavailable to free accounts. Its free `TIME_SERIES_DAILY` response is valid OHLCV, but has no adjusted close, dividends or splits. The connector documents this distinction at the pinned source revision.

## Evidence

[alpha_vantage#349](https://github.com/RomelTorres/alpha_vantage/issues/349), [`alphavantage.ts` at the reviewed revision](https://github.com/pacocartones/market-data-sanity-checker/blob/86ffa3af564704c0d5ec6ca7ae16c45c9b810a82/src/connectors/alphavantage.ts#L17-L20)

## A checker should report

Report which endpoint or product tier was requested and served, and mark adjustment and corporate-action coverage unavailable when the requested adjusted endpoint was not served. The parser alone cannot infer a product downgrade from empty action lists.

## The check does NOT establish

That the raw prices are wrong. They may be correct unadjusted prices, and a missing action list by itself does not prove the symbol had an action.
