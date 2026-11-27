# Contributing

Thanks for considering a contribution. This project is a **trust layer for market data**:
its value is the quality of its rule corpus, so the bar for changes is deliberate. This page
says how a change gets in; each rule it mentions is defined once, in the file it links to.

## Your first contribution

1. **Choose** an [unassigned good first issue](https://github.com/pacocartones/market-data-sanity-checker/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee+label%3A%22good+first+issue%22) (they come with their source already found), or a [help wanted](https://github.com/pacocartones/market-data-sanity-checker/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee+label%3A%22help+wanted%22) one once you know the repository. Read its latest comments and linked pull requests first. To add a rule, [docs/tutorial-first-rule.md](docs/tutorial-first-rule.md) walks one real rule (`VOLUME_NEGATIVE`) from the source to the pull request.
2. **Claim** it (see [below](#claiming-an-issue)).
3. **Fork, branch and change** the files the issue names. Anything larger than a small fix starts as an issue (rule proposal or feature request), so the approach is agreed before you write code.
4. **Check** your change (see [Setup](#setup)), plus any check the issue names.
5. **Open a pull request** against `main`, fill in the template, link the issue and paste the commands you ran with their results. A check you could not run is reported with its error, not ticked.

Your first pull request's checks wait until a maintainer approves them (a GitHub default for first-time contributors). That says nothing about your change; push to the same branch rather than closing and reopening.

## Setup

Requires Node.js ≥ 22.12 and pnpm (see `engines` and `packageManager` in `package.json`).

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint

pnpm calibrate   # 50-symbol calibration run against real Yahoo data → calibration/
pnpm calibrate --two-source  # 24 symbols, Yahoo vs Alpha Vantage (needs ALPHA_VANTAGE_API_KEY) → calibration/two-source.json
pnpm scoreboard  # provider audit over ~30 liquid symbols → scoreboard/
```

Property tests (fast-check): how to run, replay and add them is in [docs/property-tests.md](docs/property-tests.md).

## Claiming an issue

Comment `/take` on the issue and a bot assigns it to you straight away, if nobody has it and you have fewer than two open issues assigned. If you can't continue, comment `/release`; that's completely fine, and it frees the issue for someone else. An assigned issue with no activity for two weeks may be offered to another contributor, after a ping. A pull request for an issue assigned to someone else waits for them.

Issues labelled `good first issue` with the type Data are small enough that nobody claims them: open a pull request when it's ready, and the first correct one is merged.

## Good first issues

An issue carries `good first issue` only if all of these hold:

1. it can be done from public sources, with no third-party account or payment;
2. it touches one or two files, named in the issue;
3. it names a check that must pass;
4. it takes under about two hours for someone new to the repository;
5. it is unclaimed: no assignee and no open pull request;
6. a maintainer reviewed it in the last 30 days.

Labels and their meanings are in [`.github/labels.tsv`](.github/labels.tsv). The kind of work (Task, Bug, Feature, Docs or Data) is the issue type, not a label.

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

## Changesets

A change users would notice adds a [changeset](https://github.com/changesets/changesets): run `pnpm changeset` and commit the generated file with your pull request. Docs, tests and CI changes need none. Never edit `CHANGELOG.md` directly; how changesets become releases is in [RELEASING.md](RELEASING.md).

## Using AI

AI help is welcome under the [AI policy](AI_POLICY.md). Replies in this repository's issues, pull requests and discussions are prepared by an AI agent working under the supervision of the repository owner.

## Review

We reply to every new issue, pull request and `/take` comment within 24 hours, usually the same day. A reply is a real answer (a review, a question or an assignment), not an acknowledgement. Security reports follow [SECURITY.md](SECURITY.md).

A human maintainer reviews and is responsible for every merge. Every review conversation is resolved before merging, by a change or a note saying why not.

Contributions are voluntary; requests for payment get no reply and don't change how we review.

By contributing you agree to follow the [Code of Conduct](https://github.com/pacocartones/.github/blob/main/CODE_OF_CONDUCT.md) and to license your contribution under the [MIT License](LICENSE). How decisions are made: [GOVERNANCE.md](GOVERNANCE.md) and [MAINTAINERS.md](MAINTAINERS.md).

## Branch names and commit identity

**From a fork, none of this applies to you:** name your branch as you like, commit under any address, and keep the trailers your tools add. If you do not want your email in the public history, use your [GitHub noreply address](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address).

For maintainers' branches and commits in this repository, the *Commit policy* check runs [`scripts/check-commit-policy.sh`](scripts/check-commit-policy.sh), which is the source of truth for the exact patterns. In short:

- **Branch names:** `<type>/<short-slug>`, lower case with hyphens, and dots only inside a version (`docs/pin-action-v1.8.0`, `chore/release-1.9.0`); types `feat`, `fix`, `docs`, `data`, `test`, `ci`, `chore`, `refactor` (example: `fix/sitemap-canonical`). The name describes the change, not who made it. Reserved: `main`, `gh-pages`, `changeset-release/main` and `bot/*` (for example `bot/scoreboard`). Generated names accepted as-is: `codex-security/arp_<32 lowercase hex>`, and `dependabot/github_actions/<slug>` or `dependabot/npm_and_yarn/<slug>` only when Dependabot opened the pull request. These are naming exceptions only; they do not exempt commits from the identity rule.
- **Branch type and version:** `docs/`, `test/`, `ci/` and `chore/` carry no changeset; `fix/` is a patch; `feat/` is a minor (see [RELEASING.md](RELEASING.md), rules 1 and 9).
- **Commit identity:** maintainer commits (including the part done by AI agents under human oversight) use `Paco Cartones <253313177+pacocartones@users.noreply.github.com>` and carry no AI attribution trailers or footers. When we squash-merge, we drop AI `Co-authored-by` lines from the final message so `main` stays clean; your authorship stays.
- Merged and closed pull requests keep their commits; the branch in this repository is deleted afterwards.
