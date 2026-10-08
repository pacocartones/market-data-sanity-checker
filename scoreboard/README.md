# Provider scoreboard

Generated: 2026-10-08T01:32:43.172Z · basket: 30 liquid symbols · range: 1y · reproducible with `pnpm scoreboard`

| Provider | Symbols | Mean sanity score | Min | Critical | Warning | Info |
|---|---|---|---|---|---|---|
| yahoo | 30 (+0 failed) | 91.5 | 45 | 1 | 10 | 13 |
| alpha-vantage | 25 (+5 failed) | 86.4 | 40 | 2 | 7 | 31 |

## Worst-scoring symbols per provider

### yahoo

- **CAT** — 45/100 (PRICE_SPIKE_INTRADAY, RETURN_SPIKE)
- **MSFT** — 85/100 (RETURN_SPIKE)
- **NVDA** — 85/100 (RETURN_SPIKE)
- **AMZN** — 85/100 (RETURN_SPIKE)
- **META** — 85/100 (RETURN_SPIKE)

### alpha-vantage

- **WMT** — 40/100 (PRICE_SPIKE_INTRADAY, RETURN_SPIKE, CURRENCY_SUSPECT)
- **CAT** — 55/100 (PRICE_SPIKE_INTRADAY, CURRENCY_SUSPECT)
- **MSFT** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)
- **NVDA** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)
- **AMZN** — 80/100 (RETURN_SPIKE, CURRENCY_SUSPECT)

## Cross-provider consistency

```json
[
  {
    "symbol": "AAPL",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-10"
        }
      }
    ]
  },
  {
    "symbol": "MSFT",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-20"
        }
      }
    ]
  },
  {
    "symbol": "NVDA",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-04"
        }
      }
    ]
  },
  {
    "symbol": "AMZN",
    "consistency_score": 100,
    "compared_dates": 99,
    "findings": []
  },
  {
    "symbol": "META",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-15"
        }
      }
    ]
  },
  {
    "symbol": "GOOGL",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-08"
        }
      }
    ]
  },
  {
    "symbol": "TSLA",
    "consistency_score": 100,
    "compared_dates": 99,
    "findings": []
  },
  {
    "symbol": "AVGO",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-22"
        }
      }
    ]
  },
  {
    "symbol": "JPM",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2026-01-06"
        }
      }
    ]
  },
  {
    "symbol": "V",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-12"
        }
      }
    ]
  },
  {
    "symbol": "KO",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-01"
        }
      }
    ]
  },
  {
    "symbol": "PG",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-10-24"
        }
      }
    ]
  },
  {
    "symbol": "JNJ",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-25"
        }
      }
    ]
  },
  {
    "symbol": "XOM",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-14"
        }
      }
    ]
  },
  {
    "symbol": "WMT",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-12"
        }
      }
    ]
  },
  {
    "symbol": "BRK-B",
    "consistency_score": 100,
    "compared_dates": 99,
    "findings": []
  },
  {
    "symbol": "GE",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-29"
        }
      }
    ]
  },
  {
    "symbol": "CAT",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-10-20"
        }
      }
    ]
  },
  {
    "symbol": "BA",
    "consistency_score": 100,
    "compared_dates": 99,
    "findings": []
  },
  {
    "symbol": "HON",
    "consistency_score": 65,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-11-14"
        }
      },
      {
        "rule": "SPLIT_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-10-30"
        }
      },
      {
        "rule": "PRICE_DATE_MISMATCH",
        "severity": "info",
        "where": {
          "date": "2026-05-15"
        }
      }
    ]
  },
  {
    "symbol": "SPY",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-19"
        }
      }
    ]
  },
  {
    "symbol": "QQQ",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-22"
        }
      }
    ]
  },
  {
    "symbol": "IWM",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-16"
        }
      }
    ]
  },
  {
    "symbol": "DIA",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-10-17"
        }
      }
    ]
  },
  {
    "symbol": "VTI",
    "consistency_score": 85,
    "compared_dates": 99,
    "findings": [
      {
        "rule": "DIVIDEND_MISMATCH",
        "severity": "warning",
        "where": {
          "date": "2025-12-22"
        }
      }
    ]
  }
]
```
