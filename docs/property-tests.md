# Property tests

`tests/property/` holds [fast-check](https://fast-check.dev) properties: instead of one hand-written example, a property states a rule that must hold for *every* generated dataset, and fast-check searches for (and shrinks) a counter-example. They run as part of `pnpm test`; run only them with:

```bash
pnpm test:property
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `FC_NUM_RUNS` | cases per property | 100 in CI, 25 locally |
| `FC_SEED` | integer seed, or `random` to explore new inputs | fixed (so CI is reproducible) |
| `FC_PATH` | the `path` printed with a failure; re-runs just that case | unset |

**Replaying a failure.** A failing property prints the shrunk counter-example, the seed and the path, plus a ready-made `Replay:` line. Re-run it with the same values, for example `FC_SEED=20261015 FC_NUM_RUNS=25 FC_PATH=0:0:1 pnpm test:property`. To hunt for new failures, try `FC_SEED=random FC_NUM_RUNS=1000 pnpm test:property`. If you find a real bug, keep the shrunk input as an ordinary example test next to the fix.

**Adding a property for a rule.** Rules are covered by the defect-injection table in `tests/property/defects.property.test.ts`: start from a dataset that is clean by construction, inject one known defect, and require the rule to fire.

1. Read the rule and write down exactly what triggers it (and what it ignores).
2. Add one entry to `DEFECTS` with the rule id, a short label and an `inject(clean, draw)` function. `clean` is a generated gentle random walk (30 to 60 weekdays, USD, no corporate actions) that no rule objects to; `draw` gives three numbers in [0, 1) that you map to a position and a magnitude with `pickInt` and `lerp`. Return the new dataset, plus the expected `date` (and `severity`, if it is not the default) when the finding points at one site.
3. Comment WHY the injected defect must trigger the rule, citing the rule's own condition.
4. Check the test can fail: temporarily weaken the rule and see the property go red.

Generators live in `tests/property/support/arbitraries.ts` (`cleanDataset`, `validDataset`, `wildDataset`). Keep properties fast: no more than a few hundred milliseconds each at the default run count.
