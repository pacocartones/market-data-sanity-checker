# Examples — real defects, real output

Every example below is reproducible: the inputs ship in [`tests/fixtures/`](../tests/fixtures/)
(documented in [fixtures.md](fixtures.md)) and the outputs are the actual CLI text. No API key
needed for any of them.

## Golden path: local files to JSON and HTML

This path stays entirely local: both inputs ship with the repository, and none of the commands
needs an API key or network access. Start with the clean CSV; a successful gate prints the report
and exits `0`:

```bash
mdsc check --file tests/fixtures/ohlcv-valid.csv
```

Then check the anomalous JSON fixture. Its critical finding makes the gate exit `1`:

```bash
mdsc check --file tests/fixtures/mob-st-unadjusted-split.json
```

The report is still produced before the gate exits. Redirect JSON output to a file, or ask the CLI
to write the self-contained HTML dashboard directly:

```bash
mdsc check --file tests/fixtures/mob-st-unadjusted-split.json --format json > report.json
mdsc check --file tests/fixtures/mob-st-unadjusted-split.json --html report.html
```

Both commands above intentionally exit `1` because the fixture contains a critical anomaly; that
status means the data gate worked, not that report generation failed. `report.json` is ordinary
parseable JSON. `report.html` is a non-empty, self-contained file that opens locally without a
server.

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

## 4. Phantom trades: zero volume but price moved

A price can only move when trades happen, so an intraday range (`high != low`) with zero
reported volume is contradictory — documented real cases (such as 1COV.DE on Yahoo, noted in
yfinance's price-repair documentation) turned out to be corrupt vendor rows. It is flagged as a
warning rather than critical because corrupt vendor rows require verification against the source
before consuming. Bars with `volume = 0` and `high == low` represent halted or zero-trade sessions
and are intentionally not flagged:

```bash
mdsc check --file tests/fixtures/ohlcv-zero-volume-moved.csv
```

```
UNKNOWN (csv) — sanity_score: 65/100
findings: 0 critical · 2 warning · 1 info
  WARNING  INSUFFICIENT_DATA → flag
           Only 5 bar(s) provided (minimum for meaningful checks: 10). The statistical rules
           (spikes, staleness, splits) have nothing to work with, so this score reflects
           absence of evidence, not evidence of quality. Fetch more history before trusting
           the result.
  WARNING  ZERO_VOLUME_MOVED [2024-01-04] → flag
           Zero volume but the price moved intraday (high 104 != low 101), which is
           contradictory unless the instrument was halted — and halted sessions usually report
           high == low. Documented real cases (e.g. 1COV.DE on Yahoo) turned out to be corrupt vendor
           rows; verify against the source before consuming.
  INFO     CURRENCY_SUSPECT → review
           Dataset for UNKNOWN has no currency. Without it, prices cannot be interpreted (the
           LSE quotes in pence (GBX), not pounds — a GBP/GBX mix-up is a silent ×100 error).
           Record the trading currency explicitly, and use GBX for pence-quoted series.
```

## 5. Comparing two sources — and refusing to lie

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

## 6. Live data and the HTML dashboard

No fixtures needed — Yahoo works keyless:

```bash
mdsc check --provider yahoo --symbol TSLA --html report.html
```

`report.html` is a single self-contained file (works offline, no server): interactive price
chart with anomaly markers, score breakdown, and every finding with its evidence and
references. See the screenshot in the [README](../README.md).

## Run it in GitHub Actions

The same data gate can run on every push and pull request. This example keeps the JSON report as a downloadable artifact even when the gate fails:

```yaml
name: Market data gate

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  sanity-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - name: Check market data
        run: |
          npx --yes market-data-sanity-checker check \
            --file data/prices.csv \
            --fail-on critical \
            --min-score 80 \
            --format json > report.json
      - name: Upload the report
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: market-data-report
          path: report.json
```

`--fail-on critical` makes critical findings fail the data gate, while `--min-score 80` also fails it when the overall score is below 80. Exit code `1` means the data gate rejected the input; exit code `2` means the command could not perform the check. The `always()` condition lets the artifact upload run after exit code `1`, so the report is available for inspection.

If you prefer a self-contained visual report, replace the JSON redirection and artifact path with:

```bash
npx --yes market-data-sanity-checker check \
  --file data/prices.csv \
  --fail-on critical \
  --min-score 80 \
  --html report.html
```

For the HTML variant, change the artifact step's `path:` to `report.html`.

For a local smoke test, use the shipped anomalous fixture; it intentionally exits `1` while still producing a report:

```bash
pnpm exec mdsc check --file tests/fixtures/mob-st-unadjusted-split.json --fail-on critical --min-score 80 --format json > report.json
```

The command should report the `SPLIT_NOT_ADJUSTED` finding and create parseable `report.json` before returning the failing gate status.

This smoke test prints `SPLIT_NOT_ADJUSTED`, scores 60/100, exits `1`, and leaves a parseable
`report.json` for inspection.

## Exit codes for CI

Every example above exits `1` when the gate fails (critical findings, or your
`--fail-on`/`--min-score` thresholds), `0` when it passes and `2` on operational errors —
drop any of them straight into a pipeline:

```bash
mdsc check --provider yahoo --symbol AAPL --fail-on warning --min-score 80
```
