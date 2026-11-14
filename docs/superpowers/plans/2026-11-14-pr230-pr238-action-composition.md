# PR 230 + PR 238 Action Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update draft PR #230 so it preserves both its inert GitHub job-summary cells and PR #238's inert Action diagnostics.

**Architecture:** Merge the exact PR #238 head into the existing PR #230 lineage. Keep the two controls at their separate final sinks in `action/run.sh`, reconcile the shared Action test harness, and prove both controls in one invocation before adding release metadata.

**Tech Stack:** Bash, jq, TypeScript, Vitest, pnpm, GitHub composite Actions, Changesets

**Spec:** `docs/superpowers/specs/2026-11-14-pr230-pr238-action-composition-design.md`

## Global Constraints

- Preserve original PR #230 commit `5746e1c169a189e95930a90136e4fe9203c66e39` and PR #238 history through `c264b8b20ee7216dc9e881de82be0a029f4f1255`.
- Do not modify PR #238, open a new PR, force-push, merge, mark ready, release, or manually dispatch workflows.
- Do not add services, credentials, network-dependent product tests, or changes outside the composite Action boundary.
- Never print crafted control-bearing data directly to a TTY; tests must capture it as process output.
- Keep PR #230 draft and update only its existing remote branch with normal history.

## Review Focus

- A valid report that exits nonzero must still write outputs and the summary while its gating diagnostic is encoded as one recoverable log line; Task 2 adds this composed test.
- A symbol with CR/LF, links, images, HTML, and a table delimiter must remain one inert summary cell; Task 2 retains and reuses the #230 assertion in the composed invocation.
- Modern runner commands at line start and legacy `##[...]` commands inline must both remain inert; Task 3 preserves all #238 diagnostic tests.
- Ordinary `BRK.A`, Unicode, percent signs, and hashes must remain readable/recoverable; Task 3 preserves the ordinary-input and JSON-decoding assertions.
- Error exits must retain codes, reports, outputs, and intended annotations; Tasks 2 and 3 assert the existing Action contracts while reconciling the harness.

---

### Task 1: Commit the approved design and implementation plan

**Files:**
- Create: `docs/superpowers/specs/2026-11-14-pr230-pr238-action-composition-design.md`
- Create: `docs/superpowers/plans/2026-11-14-pr230-pr238-action-composition.md`

**Interfaces:**
- Consumes: approved short design from the maintainer
- Produces: immutable design and task sequence for the composed branch

- [ ] **Step 1: Verify both documents describe only PR #230/#238 composition**

Run: `git diff --check && git diff -- docs/superpowers/specs/2026-11-14-pr230-pr238-action-composition-design.md docs/superpowers/plans/2026-11-14-pr230-pr238-action-composition.md`

Expected: clean whitespace check; no #227 implementation or unrelated scope.

- [ ] **Step 2: Commit the documents**

```bash
git add docs/superpowers/specs/2026-11-14-pr230-pr238-action-composition-design.md docs/superpowers/plans/2026-11-14-pr230-pr238-action-composition.md
git commit -m "docs: plan Action hardening composition"
```

### Task 2: Add a red composition regression test on PR #230

**Files:**
- Modify: `tests/github-action.test.ts`

**Interfaces:**
- Consumes: `runAction(env)` Action harness and the existing crafted-summary fixture pattern
- Produces: `ActionResult.stderr` and a test named `keeps diagnostics and summary cells inert in the same gated run`

- [ ] **Step 1: Extend the harness to capture stderr without changing production code**

Add `stderr: string` to `ActionResult`; capture it from both successful and rejected `execFileAsync` results; return it with stdout, outputs, and summary.

- [ ] **Step 2: Write the composed failing test**

Run the existing `ohlcv-valid.csv` fixture with a crafted `MDSC_SYMBOL` containing CR/LF, an active link, raw HTML, and a table delimiter, plus `MDSC_MIN_SCORE=100`. That fixture scores 80, so the invocation emits one gating diagnostic while still producing a report and summary. Assert:

- exit code is `1`;
- stderr is exactly one `mdsc: CLI diagnostics: ` line containing a JSON string;
- decoding that string returns the complete gating diagnostic;
- the summary contains exactly one crafted-symbol row with only the expected unescaped column delimiters;
- no forged heading, active link, or raw HTML construct appears.

- [ ] **Step 3: Run the focused test to verify RED**

Run from this worktree under WSL Bash/jq: `pnpm exec vitest run tests/github-action.test.ts -t "keeps diagnostics and summary cells inert in the same gated run"`

Expected on the original #230 production code: FAIL because stderr is forwarded raw instead of using the #238 one-line JSON diagnostic prefix.

- [ ] **Step 4: Commit the red test**

```bash
git add tests/github-action.test.ts
git commit -m "test: cover composed Action output boundaries"
```

### Task 3: Merge PR #238 and reconcile the Action tests

**Files:**
- Merge: exact commit `c264b8b20ee7216dc9e881de82be0a029f4f1255`
- Modify during conflict resolution: `tests/github-action.test.ts`
- Auto-merge and inspect: `action/run.sh`
- Preserve: `.changeset/action-diagnostics-legacy.md`

**Interfaces:**
- Consumes: red composed test from Task 2 and both original regression suites
- Produces: one harness that returns stderr and contains all #230, #238, and composed assertions

- [ ] **Step 1: Merge the exact PR #238 head with normal history**

Run: `git merge --no-ff c264b8b20ee7216dc9e881de82be0a029f4f1255`

Expected: `action/run.sh` auto-merges; `tests/github-action.test.ts` requires content reconciliation.

- [ ] **Step 2: Resolve only the shared test file**

Retain one `writeFile` import, one stderr-capable harness, all #230 summary assertions, all #238 modern/legacy diagnostic assertions, and the Task 2 composed test. Remove conflict markers without weakening exact expected values.

- [ ] **Step 3: Inspect the production auto-merge**

Confirm `action/run.sh` contains both `encode_log_data` around CLI diagnostics/`die` and `markdown_cell` around File/Symbol summary values, with unchanged exit/output/report flow.

- [ ] **Step 4: Run focused Action tests to verify GREEN**

Run under Bash/jq: `pnpm exec vitest run tests/github-action.test.ts`

Expected: all Action wrapper tests pass; the composed test now passes through the #238 diagnostic encoder.

- [ ] **Step 5: Complete the merge commit**

```bash
git add action/run.sh tests/github-action.test.ts .changeset/action-diagnostics-legacy.md
git commit
```

### Task 4: Add release accounting for PR #230

**Files:**
- Create: `.changeset/encode-action-summary-cells.md`

**Interfaces:**
- Consumes: composed Action behavior from Task 3
- Produces: patch release note for package `market-data-sanity-checker`

- [ ] **Step 1: Add the patch changeset**

The summary must state that crafted file and symbol values remain inert inside the GitHub Action job-summary table, without claiming broader CLI or Markdown closure.

- [ ] **Step 2: Validate the changeset parser and status**

Run: `pnpm changeset status --verbose --since origin/main`

Expected: package `market-data-sanity-checker` receives a patch bump and both Action changesets are listed.

- [ ] **Step 3: Commit release metadata**

```bash
git add .changeset/encode-action-summary-cells.md
git commit -m "chore: add Action summary security changeset"
```

### Task 5: Verify, review, and update the existing draft

**Files:**
- Review: `action/run.sh`
- Review: `tests/github-action.test.ts`
- Review: `.changeset/action-diagnostics-legacy.md`
- Review: `.changeset/encode-action-summary-cells.md`

**Interfaces:**
- Consumes: final composed branch
- Produces: reviewed exact head on the existing PR #230 remote branch

- [ ] **Step 1: Run local static and functional verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all commands exit 0, with the platform-specific Action tests additionally run under a Bash/jq environment.

- [ ] **Step 2: Run repository and patch hygiene checks**

Run: `git diff --check origin/main...HEAD`, `git status --short`, and inspect `git diff --stat origin/main...HEAD`.

Expected: no whitespace errors, only intended files/commits, and a clean worktree.

- [ ] **Step 3: Review the complete range**

Use a fresh review of `origin/main...HEAD` focused on exit-code preservation, runner-command protocols, summary rendering, changeset accuracy, and accidental scope expansion. Address any actionable finding additively and repeat affected checks.

- [ ] **Step 4: Push normally to the existing PR #230 branch**

Run: `git push origin HEAD:codex-security/arp_279198e0aa0e35849fb7165ca2e24d00`

Expected: fast-forward update only; no force push and no mutation of the PR #238 branch.

- [ ] **Step 5: Verify exact-head GitHub state**

Confirm PR #230 remains OPEN/draft, points to the pushed head, is mergeable, and all required/functionally relevant checks complete successfully. Confirm PR #238 remains at `c264b8b20ee7216dc9e881de82be0a029f4f1255`.
