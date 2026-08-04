# Examples — real defects, real output

Every example below is reproducible: the inputs ship in [`tests/fixtures/`](../tests/fixtures/)
(documented in [fixtures.md](fixtures.md)) and the outputs are the actual CLI text. No API key
needed for any of them.

## 1. The phantom −50% crash (unadjusted split)

MOB.ST (Moberg Pharma, Nasdaq Stockholm) registered a 2:1 split in April 2023 — but the
historical prices were never adjusted, so the series shows a −50% "crash" that never happened:

```bash
mdsc check --file tests/fixtures/mob-st-unadjusted-split.json
```

```
MOB.ST (yahoo) — sanity_score: 60/100
findings: 1 critical · 0 warning · 0 info
  CRITICAL SPLIT_NOT_ADJUSTED [2023-04-14] → block
           Price moved -50.0% in one session, matching an unadjusted 2:1 split, but no split is
           registered near this date. Hypothesis: the vendor recorded the split without adjusting
           historical prices. Supporting evidence: volume moved 2.0× in the opposite direction,
           as unadjusted feeds typically do.
```

Note what a generic validator would never give you: the **causal hypothesis** and the
**supporting evidence** (volume doubling in the opposite direction — the signature of an
unadjusted split, not a real crash).

## 2. The $185 Berkshire (bad tick)

On 3-Jun-2024 an NYSE/SIP glitch printed Berkshire Hathaway (BRK.A) at $185.15 instead of
~$621,000. Trades executed on the bad price cost Interactive Brokers ~$48M. The fixture
reproduces that day:

```bash
mdsc check --file tests/fixtures/berkshire-bad-tick.json
```

```
BRK.A (sip-cta) — sanity_score: 45/100
findings: 1 critical · 1 warning · 0 info
  CRITICAL PRICE_SPIKE_INTRADAY [2024-06-03] → block
           Close of 185.15 sits far outside its neighbourhood (median 621000) and reverted to
           621000 the next session — the classic signature of a bad tick / feed error ...
           Block the datum and verify it against a second source before consuming it.
  WARNING  RETURN_SPIKE ×2 [2024-06-03] → flag
           Daily return of -100.0% is a statistical outlier (modified z-score -697.2, ...)
```

An isolated bad tick must be **far outside its neighbourhood AND revert the next session** —
a real −99.9% crash would not bounce back to $621,000 overnight. That reversal check is what
keeps this rule from crying wolf on genuine crashes.

## 3. Pence vs pounds (×100 scale)

LSE feeds notoriously mix GBX (pence) and GBP (pounds). AET.L shows the tell-tale pattern: the
price level jumps ~100× and **stays there** — a persistent scale change, not volatility:

```bash
mdsc check --file tests/fixtures/aet-l-currency-scale.json
```

```
AET.L (yahoo) — sanity_score: 85/100
findings: 0 critical · 1 warning · 0 info
  WARNING  CURRENCY_SCALE_SUSPECT [2023-09-11] → flag
           Price level shifted ~100× up at this date and stayed there (median close 4.5000
           before vs 450.5000 after), so this is a persistent scale change, not a one-session
           move. Hypothesis: the feed mixes price scales in blocks — pence vs pounds ...
```

## 4. Comparing two sources — and refusing to lie

`mdsc compare` checks whether two feeds agree on the same symbol:

```bash
# two providers (alpha-vantage needs a free ALPHA_VANTAGE_API_KEY)
mdsc compare --symbol AAPL --providers yahoo,alpha-vantage

# or two local files
mdsc compare --files yahoo-aapl.json,stooq-aapl.csv

# PowerShell: quote values with commas — mdsc compare --files "a.csv,b.csv"
```

The trust layer never reports agreement over zero evidence. Comparing two unrelated files
produces guards, not a vacuous 100/100:

```bash
mdsc compare --files tests/fixtures/ohlcv-valid.csv,tests/fixtures/mob-st-unadjusted-split.json
```

```
UNKNOWN — ohlcv-valid.csv vs yahoo — consistency_score: 20/100
compared dates: 0 · only in ohlcv-valid.csv: 5 · only in yahoo: 12
findings: 2 critical · 0 warning · 0 info
  CRITICAL INSUFFICIENT_OVERLAP → block
           ohlcv-valid.csv and yahoo share no dates at all for UNKNOWN — nothing was compared.
           A perfect consistency score here would be agreement over zero evidence. ...
  CRITICAL SYMBOL_MISMATCH → block
           Left side is UNKNOWN but right side is MOB.ST — these datasets describe different
           instruments, so every divergence below would be meaningless. ...
```

## 5. Live data and the HTML dashboard

No fixtures needed — Yahoo works keyless:

```bash
mdsc check --provider yahoo --symbol TSLA --html report.html
```

`report.html` is a single self-contained file (works offline, no server): interactive price
chart with anomaly markers, score breakdown, and every finding with its evidence and
references. See the screenshot in the [README](../README.md).

## Exit codes for CI

Every example above exits `1` when the gate fails (critical findings, or your
`--fail-on`/`--min-score` thresholds), `0` when it passes and `2` on operational errors —
drop any of them straight into a pipeline:

```bash
mdsc check --provider yahoo --symbol AAPL --fail-on warning --min-score 80
```
