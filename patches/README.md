# Dependency patches

Applied by pnpm through `patchedDependencies` in `pnpm-workspace.yaml`. Each patch is keyed to an exact version, so a dependency bump makes pnpm fail on the stale patch and a human has to review it (do not set `allowUnusedPatches`).

- `typedoc@0.28.20.patch`: replaces typedoc's call to `Minimatch#matchOne()`, which minimatch 11 made internal, with a second `Minimatch` (`flipNegate: true`) matched with `partial`. It mirrors [TypeStrong/typedoc#3151](https://github.com/TypeStrong/typedoc/pull/3151) and lets the `minimatch@<11.0.1` override (GHSA-g3hv-75wg-m249) apply to typedoc. When a typedoc release includes #3151, delete this patch, its `patchedDependencies` entry and that override.
