# Contributing

Thanks for considering a contribution. This project is a **trust layer for market data** —
its value is the quality of its rule corpus, so the bar for changes is deliberate.

## Setup

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint

pnpm calibrate   # 50-symbol calibration run against real Yahoo data → calibration/
pnpm scoreboard  # provider audit over ~30 liquid symbols → scoreboard/
```

Requires Node.js ≥ 20 and pnpm (see `engines` and `packageManager` in `package.json`).

## The rule contract

Every rule is a pure module with metadata. A new rule is only accepted with **all** of:

1. **Stable ID** — `SCREAMING_SNAKE_CASE`, e.g. `SPLIT_NOT_ADJUSTED`.
2. **Severity** — `critical` (block), `warning` (flag) or `info` (review). When in doubt,
   choose the lower severity: false positives hurt more than false negatives.
   - Severity can be **deliberate per occurrence**: the metadata declares the default,
     but a sub-case may emit a lower one on purpose — e.g. `CURRENCY_SUSPECT` is a
     `warning` for a GBP label on pence-looking prices but degrades to `info` when the
     currency is simply absent (a completeness note, not a suspicion of wrong data).
     When you do this, explain the downgrade in a code comment.
3. **Reference** — a URL to a documented real-world incident or to the literature
   justifying the threshold (e.g. Barndorff-Nielsen et al. 2009, Iglewicz & Hoaglin).
   Rules with magic numbers and no citation are not merged.
4. **Fixture** — a test fixture reproducing the problem, ideally built from the real-world
   case (dirty data from the actual incident beats synthetic data). A real-case fixture
   also needs its hand-reviewed golden report in `tests/golden/` fixing the exact expected
   findings. Goldens are **never updated blindly**: if a rule, threshold or scoring change
   alters real-case behavior, the PR must justify it (see `tests/golden.test.ts`).
5. **Explanation** — human-readable, with the causal hypothesis and the evidence. Not
   "check failed" but "possible unadjusted 2:1 split: price fell −49.7% while volume doubled".

## Principles to respect

- **Flag, don't delete.** This tool never rewrites data. It detects, explains, scores.
- **Provider-agnostic core.** Connectors to third-party APIs are plugins, never core.
- **Structure vs plausibility.** Zod schemas validate structure; the rules engine judges
  plausibility. A negative price is structurally valid and must parse.

## Releases

We use [changesets](https://github.com/changesets/changesets). Run `pnpm changeset` and
commit the generated file with your PR.
