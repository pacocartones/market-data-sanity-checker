# Provider scoreboard

Generated: 2026-11-09T14:02:12.424Z · basket: 30 liquid symbols · range: 1y · reproducible with `pnpm scoreboard`

| Provider | Symbols | Mean sanity score | Min | Critical | Warning | Info |
|---|---|---|---|---|---|---|
| yahoo | 30 (+0 failed) | 88.8 | 45 | 1 | 15 | 14 |
| alpha-vantage | 25 (+0 failed, 5 skipped: daily cap) | 84.4 | 40 | 1 | 12 | 34 |

- alpha-vantage skipped (daily request cap): GLD, TLT, EEM, ARKK, NFLX

## Worst-scoring symbols per provider

### yahoo

- **CAT** — 45/100 (PRICE_SPIKE_INTRADAY, RETURN_SPIKE)
- **MSFT** — 85/100 (RETURN_SPIKE)
- **NVDA** — 85/100 (RETURN_SPIKE)
- **AMZN** — 85/100 (RETURN_SPIKE)
- **META** — 85/100 (RETURN_SPIKE)

### alpha-vantage

- **CAT** — 40/100 (PRICE_SPIKE_INTRADAY, RETURN_SPIKE, CURRENCY_SUSPECT)
- **MSFT** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)
- **NVDA** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)
- **AMZN** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)
- **META** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)

## Cross-provider consistency

This run uses Alpha Vantage’s free daily endpoint, which returns the latest 100 daily bars without dividends or splits. Corporate-action findings can reflect unavailable coverage and do not by themselves establish a defect in either feed. This snapshot does not retain the raw datasets and field-level coverage needed to adjudicate each event. Compare corporate actions only over periods where both sources have verified coverage, then reconcile discrepancies against issuer or exchange notices.

| Symbol | Consistency score | Compared dates | Findings |
|---|---|---|---|
| AAPL | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-10) |
| MSFT | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-20) |
| NVDA | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-04) |
| AMZN | 100 | 100 | none |
| META | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-15) |
| GOOGL | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-08) |
| TSLA | 100 | 100 | none |
| AVGO | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-22) |
| JPM | 85 | 100 | DIVIDEND_MISMATCH (warning, 2026-01-06) |
| V | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-12) |
| KO | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-01) |
| PG | 85 | 100 | DIVIDEND_MISMATCH (warning, 2026-01-23) |
| JNJ | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-25) |
| XOM | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-14) |
| WMT | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-12) |
| BRK-B | 100 | 100 | none |
| GE | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-29) |
| CAT | 85 | 100 | DIVIDEND_MISMATCH (warning, 2026-01-20) |
| BA | 100 | 100 | none |
| HON | 65 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-14); SPLIT_MISMATCH (warning, 2026-06-29); PRICE_DATE_MISMATCH (info, 2026-06-17) |
| SPY | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-19) |
| QQQ | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-22) |
| IWM | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-16) |
| DIA | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-11-21) |
| VTI | 85 | 100 | DIVIDEND_MISMATCH (warning, 2025-12-22) |
