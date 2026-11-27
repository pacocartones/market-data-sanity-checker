<!-- Thanks for contributing. Delete any section or checkbox that does not apply. -->

## What changed and why

<!-- Use `Closes #123` only if this fully resolves the issue; `Related to #123` for partial work. -->

## How I tested it

<!-- The exact commands you ran and their results, plus any manual checks. Sources (link and UTC day read) for rule references and incident facts. If a check could not run, give the error. -->

## Checklist

- [ ] `pnpm test && pnpm typecheck && pnpm lint` are green locally, and I recorded the commands and results above.
- [ ] **New rule:** the full [rule contract](https://github.com/pacocartones/market-data-sanity-checker/blob/main/CONTRIBUTING.md#the-rule-contract): stable ID, severity, reference URL, fixture, and a hand-reviewed golden in `tests/golden/` (never updated blindly).
- [ ] **User-visible change:** I added a changeset (`pnpm changeset`) and updated the docs it affects (`README.md` rule catalog, `docs/fixtures.md`).
- [ ] **Factual change:** every fact comes from a primary source I opened myself, linked above with the day I read it.
- [ ] **AI help:** I used AI tools for part of this change, added an `Assisted-by: <tool>/<model>` line to the commit, and I have read and tested it myself.
