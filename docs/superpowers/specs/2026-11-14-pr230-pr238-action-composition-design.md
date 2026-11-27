# PR 230 + PR 238 Action Composition Design

## Intent

Update the existing draft PR #230 so its GitHub Action summary-cell hardening composes with the already validated diagnostic-log hardening from PR #238. Preserve the original commits and authorship of both pull requests, leave PR #238 unchanged, and produce one final PR #230 head that protects both output boundaries.

## Goals

- Merge PR #238 into the existing PR #230 history with a normal merge.
- Keep `encode_log_data` on Action diagnostics and `markdown_cell` on `GITHUB_STEP_SUMMARY` File and Symbol cells.
- Reconcile `tests/github-action.test.ts` without losing either regression suite.
- Add one composition test that exercises diagnostic encoding and summary-cell encoding in the same Action invocation.
- Add a patch changeset for the summary-cell security fix.
- Validate the composed head locally and through the repository's full remote CI matrix.

## Non-goals

- Do not modify PR #238, open another PR, force-push, merge, mark ready, release, or dispatch workflows manually.
- Do not change CLI, report Markdown, provider, service, credential, or security-advisory behavior.
- Do not claim closure of a broader finding beyond the two Action output boundaries covered here.

## Constraints

- Work only in the managed `compose-pr230-with-238` worktree.
- Keep the original PR #230 commit `5746e1c169a189e95930a90136e4fe9203c66e39` and PR #238 commits through `c264b8b20ee7216dc9e881de82be0a029f4f1255` in history.
- Update the existing remote PR #230 branch only by normal merge and additive commits.
- Treat crafted values as test data; never emit control-bearing values directly to an interactive terminal.

## Approaches

### Selected: merge PR #238 into PR #230, then reconcile additively

This preserves both original histories, updates the existing draft, and matches the intended integration order. The production `action/run.sh` changes already auto-merge; only the test harness needs deliberate reconciliation.

### Rejected: recreate both fixes on a new branch

This would lose the direct ancestry and attribution of the generated security patches and would require a new PR, which is outside scope.

### Rejected: change PR #238 to include PR #230

PR #238 is already validated and must remain immutable. It is the integration base, not the branch to mutate.

## Design

`action/run.sh` retains two separate final-boundary controls:

1. CLI stderr is captured, encoded as one JSON string with legacy runner-command hashes neutralized, and replayed as one diagnostic line.
2. The generated JSON report is parsed and its File and Symbol values pass through `markdown_cell` immediately before the job-summary row is emitted.

The test harness captures both stdout and stderr. Existing #238 tests continue to prove modern and legacy runner commands remain inert and recoverable. Existing #230 tests continue to prove crafted Markdown remains in one summary row. A new composed test uses one valid but gated report so the same invocation produces encoded diagnostics and a crafted summary cell, proving neither control displaces the other.

Release accounting consists of the existing #238 diagnostic changeset plus a new patch changeset describing #230's summary-cell fix.

## Success criteria

- The composed test is red on the original #230 head and green after merging #238.
- Every #230 and #238 Action regression assertion remains present and passes under Bash/jq.
- Typecheck, lint, unit suite, build, README smoke where applicable, diff checks, and exact-head GitHub CI pass.
- PR #230 remains draft and PR #238 remains byte-for-byte unchanged at its remote head.
