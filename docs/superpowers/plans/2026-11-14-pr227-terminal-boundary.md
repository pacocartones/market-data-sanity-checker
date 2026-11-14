# PR 227 Terminal Output Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every human-oriented CLI output boundary inert to terminal controls while preserving machine formats and legitimate Unicode.

**Architecture:** Keep one pure fragment sanitizer in `src/report/terminal.ts` and call it only from human renderers and caught-error formatting. Structured JSON, Markdown, HTML, CSV, and persisted history retain their own serializers; audit-history table cells are sanitized inside the table renderer.

**Tech Stack:** TypeScript, Node.js `stripVTControlCharacters`, Commander, Vitest, ESLint, pnpm, Changesets

**Spec:** `docs/superpowers/specs/2026-11-14-pr227-terminal-boundary-design.md`

## Global Constraints

- Preserve PR #227 commit `9cdc421ef30318c18a5b5e3e25c4247c4788b950` and merge fixed main input `4b40f95a78fb3487ea84133eff1f8073d7cac755` with normal history.
- Do not chase a later main head, merge the pull request into main, mark it ready, release, force-push, or mutate any branch other than the existing PR #227 remote branch.
- Do not add a global console/stream transform or a TTY-only security branch.
- Do not change JSON, CSV, Markdown, HTML, JSONL, provider, rule, or PR #231 contracts.
- Preserve U+200B, U+200C, U+200D, U+2060, emoji joiner sequences, and ordinary multilingual Unicode.
- Never print crafted control-bearing fixtures directly to a TTY; inspect only captured test output.
- Fix lint without disabling `no-control-regex` or another rule.

## Review Focus

- A quoted CSV header containing VT commands and a line break must produce one inert operational-error line; Task 3 adds the subprocess regression.
- A hand-edited JSONL history entry can carry controls in its date or rule IDs; Task 4 sanitizes table cells while preserving history JSON.
- An OSC command may be terminated by BEL or ST, or left incomplete; Task 2 covers complete and incomplete forms.
- Non-bidi `Cf` characters and emoji joiner sequences must remain unchanged; Task 2 covers U+200B, ZWNJ, ZWJ, U+2060, and a joined emoji.
- Machine renderers must retain their original values even when the equivalent table output is sanitized; Tasks 2, 3, and 4 add Markdown and JSON contract tests.

---

### Task 1: Commit the approved design and implementation plan

**Files:**
- Create: `docs/superpowers/specs/2026-11-14-pr227-terminal-boundary-design.md`
- Create: `docs/superpowers/plans/2026-11-14-pr227-terminal-boundary.md`

**Interfaces:**
- Consumes: maintainer-approved fragment-boundary design
- Produces: immutable scope, interfaces, and TDD sequence for PR #227

- [ ] **Step 1: Verify the documents stay inside PR #227 scope**

Run: `git diff --check && git diff -- docs/superpowers/specs/2026-11-14-pr227-terminal-boundary-design.md docs/superpowers/plans/2026-11-14-pr227-terminal-boundary.md`

Expected: clean whitespace; no PR #231 implementation and no claim that terminal escaping owns Markdown.

- [ ] **Step 2: Commit the documents**

```bash
git add docs/superpowers/specs/2026-11-14-pr227-terminal-boundary-design.md docs/superpowers/plans/2026-11-14-pr227-terminal-boundary.md
git commit -m "docs: plan terminal output boundary"
```

### Task 2: Narrow the primitive and detach machine renderers

**Files:**
- Merge: `4b40f95a78fb3487ea84133eff1f8073d7cac755`
- Modify: `src/report/terminal.ts`
- Modify: `src/report/markdown.ts`
- Modify: `tests/report-terminal.test.ts`
- Modify: `tests/report-markdown.test.ts`
- Modify: `tests/cli-gating.test.ts`

**Interfaces:**
- Consumes: Node `stripVTControlCharacters(value: string): string`
- Produces: `escapeTerminalText(value: string): string` and `formatTerminalError(error: unknown): string`

- [ ] **Step 1: Merge the fixed main input with normal history**

Run: `git merge --no-ff 4b40f95a78fb3487ea84133eff1f8073d7cac755`

Expected: original PR #227 commit remains an ancestor; fixed main changes are present; no later main commit is introduced.

- [ ] **Step 2: Write failing Unicode and Markdown boundary tests**

In `tests/report-terminal.test.ts`, assert `escapeTerminalText` preserves `München 東京`, U+200B, U+200C, U+200D, U+2060, and a joined emoji while visibly encoding C0/C1, lone surrogates, U+2028/U+2029, and Unicode `Bidi_Control` characters. Assert CSI, OSC-BEL, OSC-ST, and incomplete escape introducers leave no live introducer. Add direct `formatTerminalError` cases for an `Error` and a non-Error value, both carrying a control-bearing fragment.

In `tests/report-markdown.test.ts`, assert `escapeCell` and `escapeHeading` preserve U+200B, ZWNJ, ZWJ, and the joined emoji. In `tests/cli-gating.test.ts`, remove the expectation that Markdown uses terminal escaping and replace the raw-control regex with per-code-point captured-output assertions.

- [ ] **Step 3: Run focused tests and lint to verify RED**

Run: `pnpm exec vitest run tests/report-terminal.test.ts tests/report-markdown.test.ts tests/cli-gating.test.ts -t "terminal|Unicode|markdown"`

Then run: `pnpm lint`

Expected before implementation: Unicode/Markdown assertions fail because all `Cf` is encoded, and lint still reports `no-control-regex` until the test rewrite is complete.

- [ ] **Step 4: Implement the targeted primitive and machine-format separation**

In `src/report/terminal.ts`, replace the all-`Cf` matcher with the union of `Cc`, `Cs`, `Zl`, `Zp`, and `Bidi_Control`; keep stable visible escapes and add `formatTerminalError(error: unknown): string` as a pure delegation to `escapeTerminalText`.

In `src/report/markdown.ts`, remove the terminal import and restore Markdown-only behavior: line collapsing, table-cell escaping, and Markdown/HTML construct escaping. Do not introduce another terminal helper there.

- [ ] **Step 5: Run focused tests and lint to verify GREEN**

Run: `pnpm exec vitest run tests/report-terminal.test.ts tests/report-markdown.test.ts tests/cli-gating.test.ts`

Then run: `pnpm lint`

Expected: focused tests pass and ESLint reports zero errors without suppressions.

- [ ] **Step 6: Commit the primitive boundary**

```bash
git add src/report/terminal.ts src/report/markdown.ts tests/report-terminal.test.ts tests/report-markdown.test.ts tests/cli-gating.test.ts
git commit -m "fix: narrow terminal control escaping"
```

### Task 3: Cover report and operational-error sinks

**Files:**
- Modify: `src/cli.ts:50-111,250-406`
- Modify: `tests/cli-gating.test.ts`

**Interfaces:**
- Consumes: `escapeTerminalText(value: string): string`, `formatTerminalError(error: unknown): string`
- Produces: inert human `check`/`compare` tables, confirmations, and operational diagnostics

- [ ] **Step 1: Write the crafted-CSV and human-report failing tests**

Create a temporary CSV whose quoted, missing-required-field header contains CSI/OSC data and a CR/LF fragment that is reflected by `IngestError`. Run `check` as a child process and assert exit code 2, empty stdout, exactly one non-empty stderr line, no live ESC/BEL/CR, and visible escapes for remaining controls.

Add captured subprocess cases for a control-bearing `--symbol`/`--source` in table output and a control-bearing path in a `compare` error. Assert table/error output is inert while `check --format json` returns the original symbol and source values unchanged.

- [ ] **Step 2: Run the focused cases to verify RED**

Run: `pnpm exec vitest run tests/cli-gating.test.ts -t "terminal|crafted CSV|compare error"`

Expected: the CSV and compare catch-path cases fail because raw `error.message` reaches stderr.

- [ ] **Step 3: Sanitize dynamic fragments at the human sinks**

In `src/cli.ts`, apply `escapeTerminalText` to report symbols, sources, finding rule/where/explanation fragments, comparison symbols/sources, and user-controlled paths printed by HTML/history confirmations. Replace `check` and `compare` catch interpolation with `formatTerminalError(error)`. Keep numeric/trusted literals unchanged and leave the JSON and Markdown branches untouched.

- [ ] **Step 4: Run report/error tests to verify GREEN**

Run: `pnpm exec vitest run tests/cli-gating.test.ts -t "terminal|crafted CSV|compare error|keeps a hostile --symbol"`

Expected: all selected tests pass; JSON and Markdown assertions retain their independent contracts.

- [ ] **Step 5: Commit report/error coverage**

```bash
git add src/cli.ts tests/cli-gating.test.ts
git commit -m "fix: sanitize human CLI diagnostics"
```

### Task 4: Cover audit-history and rule diagnostics

**Files:**
- Modify: `src/history/store.ts:96-125`
- Modify: `src/cli.ts:409-552`
- Modify: `tests/history.test.ts`
- Modify: `tests/cli-gating.test.ts`

**Interfaces:**
- Consumes: `escapeTerminalText(value: string): string`, `formatTerminalError(error: unknown): string`
- Produces: inert `formatHistory(entries: readonly HistoryEntry[]): string`, history headings/guidance, and unknown-rule diagnostics

- [ ] **Step 1: Write failing history and rule tests**

In `tests/history.test.ts`, pass hand-edited-style entries with controls in `at` and `rules`; assert `formatHistory` keeps one row per entry, contains visible escapes, and contains no live control characters.

In `tests/cli-gating.test.ts`, write such an entry to JSONL and run both history formats: table output must be inert, while parsed JSON must equal the original entry. Add empty-history coverage for a crafted symbol and an unknown-rule case whose ID carries controls; both human diagnostics must remain one inert logical line/block.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `pnpm exec vitest run tests/history.test.ts tests/cli-gating.test.ts -t "history.*terminal|unknown rule.*terminal"`

Expected: failures show raw cells, symbols, or rule IDs reaching human output.

- [ ] **Step 3: Implement the history and rule boundary**

Import `escapeTerminalText` into `src/history/store.ts` and sanitize only date/rule cells before width calculation. In `src/cli.ts`, sanitize history symbols in headings/guidance, use `formatTerminalError` in the history catch, and sanitize the unknown user-supplied rule ID before interpolation. Do not alter `readHistory`, `appendHistory`, JSON serialization, or registry metadata.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `pnpm exec vitest run tests/history.test.ts tests/cli-gating.test.ts -t "history|unknown rule"`

Expected: table/diagnostic cases pass and JSON round-trips the original values.

- [ ] **Step 5: Audit every human sink**

Run: `rg -n "console\\.(log|error)" src/cli.ts` and classify every dynamic interpolation as trusted, terminal-sanitized, or delegated to JSON/Markdown serialization. Record no unexplained untrusted interpolation.

- [ ] **Step 6: Commit history/rule coverage**

```bash
git add src/history/store.ts src/cli.ts tests/history.test.ts tests/cli-gating.test.ts
git commit -m "fix: sanitize remaining human CLI output"
```

### Task 5: Add release accounting and verify the draft head

**Files:**
- Create: `.changeset/terminal-output-boundary.md`
- Review: `src/report/terminal.ts`
- Review: `src/report/markdown.ts`
- Review: `src/cli.ts`
- Review: `src/history/store.ts`
- Review: `tests/report-terminal.test.ts`
- Review: `tests/report-markdown.test.ts`
- Review: `tests/history.test.ts`
- Review: `tests/cli-gating.test.ts`

**Interfaces:**
- Consumes: completed terminal-boundary implementation
- Produces: patch release metadata and a reviewed exact head on existing PR #227

- [ ] **Step 1: Add a narrowly worded patch changeset**

State that human CLI tables and diagnostics now neutralize terminal controls, including CSV-derived operational errors. Do not claim changes to JSON, Markdown, HTML, or PR #231 behavior.

- [ ] **Step 2: Validate changeset and focused contracts**

Run: `pnpm changeset status --verbose --since 4b40f95a78fb3487ea84133eff1f8073d7cac755`

Expected: `market-data-sanity-checker` receives a patch bump and the new terminal-boundary changeset is listed.

- [ ] **Step 3: Commit release metadata**

```bash
git add .changeset/terminal-output-boundary.md
git commit -m "chore: add terminal boundary changeset"
```

- [ ] **Step 4: Run full local verification**

Run each command separately: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke:readme`.

Expected: every command exits 0; any documented network-only README smoke skips are reported separately rather than hidden.

- [ ] **Step 5: Run repository and patch hygiene checks**

Run: `git diff --check 4b40f95a78fb3487ea84133eff1f8073d7cac755...HEAD`, `git status --short`, `git log --oneline --decorate --graph 4b40f95a78fb3487ea84133eff1f8073d7cac755..HEAD`, and inspect `git diff --stat 4b40f95a78fb3487ea84133eff1f8073d7cac755...HEAD`.

Expected: clean worktree; original #227 commit and fixed-main merge remain in history; no terminal change in final `src/report/markdown.ts`; only intended files and commits.

- [ ] **Step 6: Review the complete range**

Review `4b40f95a78fb3487ea84133eff1f8073d7cac755...HEAD` with fresh focus on sink completeness, structured-output preservation, Unicode compatibility, error/exit-code preservation, lint compliance, and changeset accuracy. Address actionable findings additively and rerun affected checks.

- [ ] **Step 7: Revalidate and update the existing draft branch**

Confirm remote PR #227 still points to `9cdc421ef30318c18a5b5e3e25c4247c4788b950`. If unchanged, push fast-forward only:

```bash
git push origin HEAD:codex-security/arp_09353fd13a0463d5e34fca09b3d12cc4
```

Expected: no force push and no branch other than PR #227 changes.

- [ ] **Step 8: Verify exact-head GitHub state**

Confirm PR #227 remains OPEN/draft, points to the pushed head, is mergeable, and all required/functionally relevant checks complete successfully. Report any skipped check distinctly from success.
