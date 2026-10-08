# Your first rule, end to end

This guide walks through adding a rule to market-data-sanity-checker, using a real one as the example: `VOLUME_NEGATIVE`, which flags a bar whose volume is negative or not a finite number. It is the smallest rule in the catalog (about 50 lines), so every step is visible.

The contract every rule must meet is in [CONTRIBUTING.md](../CONTRIBUTING.md#the-rule-contract). This guide is the same contract, done once by hand.

## 0. Before you write code: find the case

Every rule starts from a real defect that someone documented, or from the literature behind a threshold. **No real-world case, no rule.**

- Good sources are a GitHub issue in a data library with sample rows, a vendor's own changelog or status page, a regulator or exchange notice, a reputable news report, or a paper.
- `VOLUME_NEGATIVE` cites the tick-data cleaning rules in Barndorff-Nielsen et al. (2009): trade volume is a count, so a negative or non-finite value can only be a feed error.
- Write down the URL and the date you read it. You'll need both.

If you want a defect to work on, the [good first issues](https://github.com/pacocartones/market-data-sanity-checker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) come with their source already found.

## 1. Set up

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint
```

All three should pass before you change anything. Node.js 22.12 or newer is required (see `engines` in `package.json`).

## 2. Write the fixture first

A fixture is the smallest dataset that shows the defect. For a real-case rule, build it from the documented case. Keep the symbol and dates, and only as many bars as you need.

- Real-case fixtures live in [`tests/fixtures/`](../tests/fixtures/) and are listed in [`docs/fixtures.md`](fixtures.md) with their source.
- For a deterministic rule like `VOLUME_NEGATIVE`, a few synthetic bars inside the unit test are enough. Look at `tests/rules/deterministic-price.test.ts`:

```ts
const data = dataset([
  { timestamp: '2024-01-02', open: 10, high: 10, low: 10, close: 10, volume: -500 },
  { timestamp: '2024-01-03', open: 10, high: 10, low: 10, close: 10, volume: Number.NaN },
  { timestamp: '2024-01-04', open: 10, high: 10, low: 10, close: 10, volume: 0 },
  { timestamp: '2024-01-05', open: 10, high: 10, low: 10, close: 10 },
])
```

Notice the two **negative controls**: zero volume (a real market state) and missing volume. A rule is as much about what it must *not* flag.

## 3. Write the test, and watch it fail

Add a `describe` block for your rule in the matching file under [`tests/rules/`](../tests/rules/). Rules are tested in isolation: call `check()` directly, with no engine or registry.

```ts
describe('VOLUME_NEGATIVE', () => {
  it('flags negative and non-finite volume, but NOT zero or missing volume', () => {
    const findings = volumeNegative.check(data, ctxFor(volumeNegative))

    expect(findings).toHaveLength(2)
    expect(findings[0]!.where).toEqual({ date: '2024-01-02' })
    expect(findings[0]!.evidence).toEqual({ volume: -500 })
    expect(findings[0]!.action).toBe('block')
  })
})
```

Run `pnpm test` and confirm it fails because the rule doesn't exist yet.

## 4. Write the rule

One file under `src/rules/<block>/`, named after the rule in kebab-case. Here it is [`src/rules/price/volume-negative.ts`](../src/rules/price/volume-negative.ts):

```ts
export const volumeNegative: Rule = {
  meta: {
    id: 'VOLUME_NEGATIVE',      // stable, SCREAMING_SNAKE_CASE, part of the public report
    block: 'price',             // price | corporate | fundamentals | metadata
    severity: 'critical',       // critical | warning | info — when in doubt, the lower one
    dimension: 'validity',      // DAMA dimension: validity, accuracy, completeness, …
    description: 'Volume is negative or not a finite number',
    defaultParams: {},          // every number the rule uses lives here, with a citation
    references: ['https://…'],  // the case or the literature, as http(s) URLs
  },

  check(data, context) {
    const findings: Finding[] = []
    for (const bar of data.bars) {
      const volume = bar.volume
      if (volume === undefined || (Number.isFinite(volume) && volume >= 0)) continue
      findings.push({
        rule: 'VOLUME_NEGATIVE',
        severity: context.config.severity,
        action: 'block',
        dimension: 'validity',
        where: { date: bar.timestamp },
        explanation: `Volume is ${volume}, which is structurally impossible: … Hypothesis: … Block this bar and re-fetch it from the source.`,
        evidence: { volume },
      })
    }
    return findings
  },
}
```

The rules every rule follows:

- **Pure and total.** No I/O, no mutation of the input, and never throw. Degenerate datasets (empty, one bar) return no findings.
- **One finding per occurrence.** The engine collapses them into one report entry with a count, so don't group them yourself.
- **Explain like a person.** State what was seen, the causal hypothesis and what to do: "Volume is −500 … a vendor sign error … re-fetch it", not "check failed".
- **No magic numbers.** A threshold goes in `defaultParams` (users can override it), and its value is justified by `references`.

## 5. Register it

Add the import and the entry to [`src/rules/registry.ts`](../src/rules/registry.ts), in its block:

```ts
import { volumeNegative } from './price/volume-negative'
// …
export const registry: Rule[] = [
  // price
  // …
  volumeNegative,
]
```

[`tests/rule-references.test.ts`](../tests/rule-references.test.ts) checks that every rule in the catalog cites at least one http(s) reference. It also pins the catalog size: raise the expected count by one.

## 6. Golden report (real-case fixtures only)

If your fixture reproduces a real case, add its hand-reviewed golden report under `tests/golden/`. It fixes the exact findings the whole engine produces for that fixture. Read every line before you commit it.

Goldens are **never updated blindly**. If your rule changes another fixture's golden, the pull request must explain why. See `tests/golden.test.ts`.

## 7. Document it

- Add a row to the rule catalog in the [README](../README.md#rule-catalog): ID, severity and a one-line description.
- If you added a real-case fixture, add it to [`docs/fixtures.md`](fixtures.md) with its source.

## 8. Changeset and pull request

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm changeset   # "minor" for a new rule; describe it in one sentence
```

Then open the pull request. The template has a short checklist, and it's the same contract as above. A maintainer replies within 24 hours.

Using an AI assistant for any of this is fine; see [AI_POLICY.md](../AI_POLICY.md). The one thing to check by hand is the source. Open the reference yourself and make sure it says what the rule claims.
