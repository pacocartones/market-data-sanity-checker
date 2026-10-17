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

Requires Node.js ≥ 22.12 and pnpm (see `engines` and `packageManager` in `package.json`).

## Your first rule

New here? [docs/tutorial-first-rule.md](docs/tutorial-first-rule.md) walks one real rule (`VOLUME_NEGATIVE`) from the source to the pull request. The [good first issues](https://github.com/pacocartones/market-data-sanity-checker/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) come with their source already found.

## Claiming an issue

Comment `/take` on the issue and a bot assigns it to you straight away, if nobody has it and you have fewer than two open issues assigned. If you can't continue, comment `/release`; that's completely fine, and it frees the issue for someone else. An assigned issue with no activity for two weeks may be offered to another contributor, after a ping. A pull request for an issue assigned to someone else waits for them.

Issues labelled both `good first issue` and `data` are small enough that nobody claims them: open a pull request when it's ready, and the first correct one is merged.

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

## Adding an incident case

A case is **one new file** in [`incidents/`](incidents/) (see its README and the checklist in [`incidents.md`](incidents.md)). Do not edit the table in `incidents.md`: it is generated from the case files, and a hand-edited row is what makes two incident pull requests conflict. A maintainer runs `pnpm incidents:index` after merging, so a pull request that only adds `incidents/<slug>.md` does not conflict over the table. Run `pnpm incidents:check` before you push; it checks that your case file is well formed.

## Principles to respect

- **Flag, don't delete.** This tool never rewrites data. It detects, explains, scores.
- **Provider-agnostic core.** Connectors to third-party APIs are plugins, never core.
- **Structure vs plausibility.** Zod schemas validate structure; the rules engine judges
  plausibility. A negative price is structurally valid and must parse.

## Property tests

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

## Using AI

AI-assisted contributions are welcome. Please read [AI_POLICY.md](AI_POLICY.md): understand and test your change, check facts at their source, and own what you submit. Saying you used AI is optional and never counts against you. We also maintain this project with AI agents under human oversight; a human maintainer reviews every merge.

Replies in this repository's issues, pull requests and discussions are prepared by an AI agent working under the supervision of the repository owner.

Commit messages: AI-assisted contributions are welcome when you have verified the change (see above). You do not need to remove a trailer your tool adds, and you can commit under any email address. Commits written by the maintainers carry no AI attribution trailers and use GitHub noreply addresses; the *Commit policy* check on pull requests enforces that for maintainer identities only. When we squash-merge, we drop AI `Co-authored-by` lines from the final message so `main` stays clean; your authorship stays.

## Review

A human maintainer reviews and is responsible for every merge. Automated review comments (CodeRabbit) are advisory: a person makes the call, and you don't need to reply to the bot. We resolve every review conversation, from people or bots, before merging, either by changing the code or by noting why not.

For maintainers: CodeRabbit doesn't review this repository automatically yet, so request it on each pull request that changes code with a `@coderabbitai review` comment. A green CodeRabbit status is not a review.

## Releases

We use [changesets](https://github.com/changesets/changesets). Run `pnpm changeset` and
commit the generated file with your PR.

## Branch names and commit identity

- **If you contribute from a fork, none of the branch rules apply to you:** name your branch as you
  like. They are for the maintainers' branches in this repository.
- **Maintainers' branch names:** `<type>/<short-slug>`, lower case with hyphens, where the type is
  the conventional-commit type: `feat/`, `fix/`, `docs/`, `test/`, `ci/`, `chore/` or `refactor/`. Example: `fix/sitemap-canonical`. Branch names
  describe the change, not who made it or an internal ticket. Reserved: `main`, `gh-pages`, `changeset-release/main` and `bot/*` (for example `bot/scoreboard`).
- **What a branch type means for the version** (maintainers' branches): `docs/`, `test/`, `ci/` and
  `chore/` carry no changeset; `fix/` is a patch; `feat/` is a minor (see `RELEASING.md`, rules 1
  and 9). If you contribute from a fork, add a changeset when your change affects users, whatever
  your branch is called.
- **What happens to branches:** in this repository, merged and closed pull requests keep their
  commits and the branch is deleted afterwards; branches in your fork are yours.
- **Commit identity:** maintainers commit as
  `Paco Cartones <253313177+pacocartones@users.noreply.github.com>` (how the project is maintained,
  including the part done by AI agents under human oversight, is described under [Using AI](#using-ai)), and
  `scripts/check-commit-policy.sh` checks maintainer commits only. If you do not want your email in
  the public history, use your GitHub noreply address
  ([how](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address)).
