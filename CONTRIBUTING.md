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

## Your first rule

New here? [docs/tutorial-first-rule.md](docs/tutorial-first-rule.md) walks one real rule (`VOLUME_NEGATIVE`) from the source to the pull request. The [good first issues](https://github.com/pacocartones/market-data-sanity-checker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) come with their source already found.

We reply to every new issue, pull request and "can I take this?" comment within 24 hours, usually the same day. A reply is a real answer (a review, a question or an assignment), not an acknowledgement.

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

## Using AI

AI-assisted contributions are welcome. Please read [AI_POLICY.md](AI_POLICY.md): understand and test your change, check facts at their source, and own what you submit. Saying you used AI is optional and never counts against you. We also maintain this project with AI agents under human oversight; a human maintainer reviews every merge.

Replies in this repository's issues, pull requests and discussions are prepared by an AI agent working under the supervision of the repository owner.

## Review

A human maintainer reviews and is responsible for every merge. Automated review comments (CodeRabbit) are advisory: a person makes the call, and you don't need to reply to the bot. We resolve every review conversation, from people or bots, before merging, either by changing the code or by noting why not.

For maintainers: CodeRabbit doesn't review this repository automatically yet, so request it on each pull request that changes code with a `@coderabbitai review` comment. A green CodeRabbit status is not a review.

## Releases

We use [changesets](https://github.com/changesets/changesets). Run `pnpm changeset` and
commit the generated file with your PR.
