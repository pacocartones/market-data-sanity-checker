# Releasing

How releases of this repository are made and what every release looks like. The same
standard applies to the maintainer's other public repositories.

## Rules

1. **Versioning:** SemVer. Breaking changes only in a major version.
2. **Tags:** `vX.Y.Z`, never moved. The GitHub Action also has a moving major tag (`v1`)
   that follows the latest compatible release; users who want certainty pin a commit SHA. The
   README's Action example pins the commit of the latest release, with its version in the
   comment; update it in the same change that moves `v1`.
3. **Source:** only from `main`, with every check green, from the exact commit that was tested.
4. **Approval:** publishing to npm runs in the `release` environment, which needs a
   maintainer's approval. When nothing is pending, the release job is skipped and no approval
   is asked.
5. **Changelog:** generated from changesets with `@changesets/changelog-github`, one entry per pull request, never edited by hand
   on a branch. The plugin adds the pull request link and `Thanks @user` for the author (maintainers are
   left out of the release notes); an entry may also say `Thanks @user` itself.
6. **Attribution:** no AI attribution or AI co-author trailers in the title, the notes, the
   changelog or the tags.
7. **Pre-releases:** `vX.Y.Z-rc.N` for a major version, marked as pre-release on GitHub.
8. **Verification:** npm packages are published from CI with provenance (trusted publishing);
   the notes say how to check it.
9. **Cadence:** no fixed calendar. A release ships when it is useful to users.
10. **GitHub Marketplace:** the Action is listed from a release; the maintainer ticks
    "Publish this Action to the GitHub Marketplace" on that release in the web interface.

## What a release looks like

**Title:** `vX.Y.Z — <one-line summary>`

**Notes**, in this order (sections with nothing to say are left out):

- A one-paragraph summary: what changes for users and whether they need to do anything.
- `### Breaking changes and upgrade` (major versions only; otherwise the notes say
  "No breaking changes.").
- `### Added` (minor changesets) and `### Changed and fixed` (patch changesets).
- `### Contributors`, when an entry thanks someone.
- `### Verify`: how to check the npm provenance of this version.

`pnpm release-notes build <version>` writes this title and these notes from `CHANGELOG.md`;
the release workflow applies them to the GitHub release after publishing, and the
`Release notes` workflow checks every published or edited release
(`pnpm release-notes check <file> --title "<title>"`). The skeleton is in
[`.github/release-template.md`](.github/release-template.md).

## Coverage badge

The README's coverage badge is a [shields.io endpoint badge](https://shields.io/badges/endpoint-badge)
fed by `coverage-badge.json`, which the `Deploy API Docs` workflow publishes next to the API docs
on GitHub Pages. On every push to `main` it runs `pnpm test:coverage` (vitest with the v8 provider)
and `pnpm coverage:badge`, which turns `coverage/coverage-summary.json` into the endpoint file.
No coverage service and no secret are involved.

It shows **line coverage of `src/`** as a whole percent, rounded down, so it never overstates:
red below 60, yellow below 80, green from 80. Excluded from the measurement (see
`vitest.config.ts`): tests, scripts, config files, the `index.ts` barrel, type-only files.
Statement, function and branch coverage are in the `pnpm test:coverage` output but not on the
badge. Coverage says which lines the tests executed, not that they assert the right thing: a
high number is not evidence that the rules are correct. The golden and calibration suites are
what speak to correctness. If the coverage run fails or the summary is missing or unusable, no badge file is written and
the docs still deploy; the badge then shows as invalid until the next successful run on `main`,
which is the visible signal (a stale or invented number is never published). The badge only
appears after the first successful deploy of that workflow.
