## Checklist

- [ ] `pnpm test && pnpm typecheck && pnpm lint` are green locally
- [ ] New rules include the full contract: stable ID + severity + reference URL + fixture + hand-reviewed golden in `tests/golden/` (never updated blindly)
- [ ] Docs updated where affected (`README.md` rule catalog, `docs/fixtures.md`)
- [ ] Changeset added (`pnpm changeset`)
