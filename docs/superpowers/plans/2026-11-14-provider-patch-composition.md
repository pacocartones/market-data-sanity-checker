# Provider Patch Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose #228 then #237 on current `main`, correct the stale parser fixture, and prove credential-safe final output at connector, CLI, and scoreboard boundaries.

**Architecture:** Retain both original commits through merge ancestry. Add tests on the #228-composed head so they fail on the leaked detail, then merge #237 to make them pass; do not add a response-like compatibility layer.

**Tech Stack:** TypeScript, Node.js 22/24, Vitest 4, pnpm, Commander, standard Fetch `Response`/`ReadableStream`.

**Spec:** `docs/superpowers/specs/2026-11-14-provider-patch-composition-design.md`

## Global Constraints

- Preserve commits `5233b9bd24ec4a805d60e7c609e80afa4f5c98be` and `cb639200f1bb9f446db2b44030601e85a1a13af7` and their original author.
- Compose from `origin/main` at `4b40f95a78fb3487ea84133eff1f8073d7cac755` without mutating `main`.
- Use only synthetic secrets and stubbed local behavior; never contact providers.
- No fallback to `.json()`-only response doubles.
- No force-push, merge, release, issue closure, new scan, or clone.

## Review Focus

- Invalid streamed JSON containing a synthetic credential must produce one exact static connector error and no reflected body text.
- The compiled CLI must print only the categorized static message to stderr with exit code 2.
- The scoreboard must log only the static connector message and abort before writing when every stubbed provider fails quorum.
- A valid, sub-limit real `Response` must still parse successfully.
- Timeout errors must retain their distinct bounded timeout category.

---

### Task 1: Prove the real parser and caller failures on the #228 head

**Files:**
- Modify: `tests/connectors-alphavantage.test.ts`
- Modify: `tests/cli-gating.test.ts`
- Create: `tests/scoreboard-provider-errors.test.ts`

**Interfaces:**
- Consumes: #228's `readProviderJson(response: Response, provider: string): Promise<unknown>` through `alphaVantage.fetchDaily`.
- Produces: regression tests whose expected public payload is `Alpha Vantage request failed for IBM` or the same category with the scoreboard symbol.

- [ ] **Step 1: Add the connector regression test**

Use a real `Response` whose invalid JSON body contains `response-secret-key`; assert `ConnectorError`, exact message `Alpha Vantage request failed for IBM`, and absence of the secret and remote line breaks.

- [ ] **Step 2: Add the compiled CLI regression test**

Create a temporary Node preload module that replaces `globalThis.fetch` with a real invalid `Response`. Run `dist/cli.js check --provider alpha-vantage --symbol IBM`, then assert exit code 2, empty stdout, exact stderr, and absence of the synthetic secret.

- [ ] **Step 3: Add the scoreboard regression test**

Stub `fetch`, timers, `console.log`, `console.error`, and `process.exit`; dynamically import the scoreboard script; assert the exact Alpha Vantage failure line and absence of the secret from every captured final log.

- [ ] **Step 4: Verify RED on the #228-composed head**

Run: `pnpm build && pnpm exec vitest run tests/connectors-alphavantage.test.ts tests/cli-gating.test.ts tests/scoreboard-provider-errors.test.ts`

Expected: the three new assertions fail because the pre-#237 connector includes parser detail in the public message; ordinary real-response and timeout controls remain green.

- [ ] **Step 5: Commit only the failing tests and design/plan**

Commit these additions on the final #237 integration branch before merging #237.

### Task 2: Integrate #237 and resolve the overlap

**Files:**
- Modify through merge resolution: `src/connectors/alphavantage.ts`
- Modify through merge resolution: `tests/connectors-alphavantage.test.ts`

**Interfaces:**
- Consumes: #228's bounded response reader and the failing tests from Task 1.
- Produces: static Alpha Vantage error categories with no provider-controlled detail.

- [ ] **Step 1: Merge original #237 commit with `--no-ff`**

Merge `cb639200f1bb9f446db2b44030601e85a1a13af7`, preserving it as an ancestor and resolving the Alpha Vantage overlap without rewriting either original commit.

- [ ] **Step 2: Resolve fixtures toward the real contract**

Retain #228's real `Response` success fixtures and the Task 1 invalid-body fixture; remove the stale `.json()`-only parser failure double. Keep #237's static provider-field, transport, timeout, and premium classification assertions.

- [ ] **Step 3: Verify GREEN**

Run the same focused command from Task 1.

Expected: all focused tests pass; the new tests fail if the generic catch again appends `error.message`.

### Task 3: Verify, review, and update the draft series

**Files:**
- Create outside source checkout: a new persistent composition/fix report.
- Do not modify the original assessment artifacts.

**Interfaces:**
- Consumes: exact combined Git head after Task 2.
- Produces: reviewed fast-forward candidates for #228 and #237 plus immutable verification evidence.

- [ ] **Step 1: Run exact-head verification**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm exec vitest run tests/check-commit-policy.test.ts`.

- [ ] **Step 2: Request independent read-only review**

Give the reviewer the base/head range, this plan, the contract finding, the red/green evidence, and the requirement to inspect both final sinks.

- [ ] **Step 3: Address every Critical or Important finding**

Use a new failing test for any behavior fix, rerun the focused and full verification, and request follow-up review when needed.

- [ ] **Step 4: Write the new composition/fix report**

Record commit graph, authors, exact hashes, red/green commands, full verification, reviewer verdict, limitations, and proposed draft updates in a new managed artifact.

- [ ] **Step 5: Update existing drafts by normal fast-forward only**

Re-read remote heads. Push the #228 merge head to its existing branch, then push the reviewed combined head to #237's existing branch. Stop if either remote moved or a push would not be fast-forward.

- [ ] **Step 6: Observe exact remote checks**

Wait for both updated draft heads to reach terminal CI. Report state and checks without merging, releasing, or closing anything.

