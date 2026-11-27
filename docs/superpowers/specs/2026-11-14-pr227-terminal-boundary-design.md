# PR 227 Terminal Output Boundary Design

## Intent

Revise draft PR #227 so untrusted fragments cannot emit terminal-control effects through any human-oriented CLI output, including operational errors derived from CSV input. Keep machine-readable output byte-for-byte governed by its own renderer and preserve legitimate Unicode formatting characters that are not terminal control primitives.

## Threat boundary

The protected boundary is human-facing text written by `mdsc` to stdout or stderr: table reports, comparison reports, audit-history tables, unknown-rule diagnostics, success confirmations, and caught operational errors. Captured or redirected human logs remain in scope because CI logs and log viewers can interpret the same control sequences as an interactive terminal.

JSON, CSV, Markdown, HTML files, JSONL history storage, and other structured artifacts are separate formats. They keep their existing escaping and serialization contracts and must not pass through a terminal-wide filter.

## Goals

- Neutralize complete VT sequences before output and visibly encode remaining terminal-dangerous code points.
- Cover CSV-derived error messages as well as successful `check`, `compare`, `history`, and `rules` human output.
- Preserve existing exit codes, logical line structure, table structure, and readable ordinary Unicode.
- Preserve U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER, and other non-bidi `Cf` characters.
- Leave Markdown behavior to PR #239 and remove PR #227's terminal-sanitizer coupling from `src/report/markdown.ts`.
- Repair the existing lint failure without disabling `no-control-regex` or another rule.
- Add a patch changeset whose claim is limited to human terminal/log output.

## Non-goals

- Do not add a process-wide `console` wrapper, stdout/stderr transform, or TTY-only branch.
- Do not change JSON values, Markdown values, CSV parsing semantics, persisted history, HTML rendering, provider behavior, or rule evaluation.
- Do not remove every Unicode `Cf` code point.
- Do not implement PR #231's boundary or claim closure of a broader output-injection class.
- Do not merge the pull request into main, mark the draft ready, release, or force-push.

## Constraints

- Preserve original PR #227 commit `9cdc421ef30318c18a5b5e3e25c4247c4788b950` in history.
- Compose once with fixed main input `4b40f95a78fb3487ea84133eff1f8073d7cac755`; do not chase later intermediate main heads.
- Update only the existing PR #227 remote branch by fast-forward push after exact-head revalidation.
- Crafted controls are test data and must only be inspected in captured process output, never printed directly to an interactive terminal.
- Tests must satisfy the existing ESLint configuration; no inline or file-level rule suppression.

## Approaches

### Selected: sanitize untrusted fragments at human renderers and diagnostics

`escapeTerminalText(value: string): string` remains the single terminal fragment primitive. It first uses Node's `stripVTControlCharacters` to remove complete CSI/OSC and related VT commands. It then visibly encodes remaining C0/C1 controls, lone surrogates, Unicode line/paragraph separators, and characters with the Unicode `Bidi_Control` property.

The targeted property set preserves U+200B, U+200C, U+200D, U+2060, emoji joiner sequences, and ordinary multilingual text. Human renderers call the primitive on untrusted cells or fragments before interpolation. Catch blocks convert an unknown error to its message and sanitize that message before adding the trusted `mdsc: ` prefix.

### Rejected: sanitize only when `isTTY` is true

Redirected CI logs, captured logs, and log viewers can interpret control sequences too. TTY-only behavior also creates two security contracts for the same human format.

### Rejected: install a global stdout/stderr filter

A global transform would also rewrite JSON and Markdown, corrupt structured output, and hide which renderer owns each escaping contract.

### Rejected: encode every Unicode `Cf` character

That breaks legitimate script shaping and emoji while exceeding the terminal-control threat model. Only bidi controls within `Cf` need visible encoding here.

## Design

### Terminal fragment primitive

`src/report/terminal.ts` exports:

```ts
escapeTerminalText(value: string): string
formatTerminalError(error: unknown): string
```

`escapeTerminalText` strips complete VT commands, then maps each remaining dangerous code point to a stable visible escape: `\\n`, `\\r`, `\\t`, `\\xNN`, `\\uNNNN`, or `\\u{N}`. `formatTerminalError` extracts `Error.message` or `String(error)` and delegates to the fragment primitive. Neither function writes output or knows about JSON, Markdown, or TTY state.

The dangerous set is expressed with Unicode properties rather than literal control ranges, so the implementation and tests satisfy `no-control-regex` without suppressions.

### Human CLI sinks

`src/cli.ts` sanitizes only dynamic untrusted fragments in:

- report symbols, sources, finding identifiers, `where` values, and explanations;
- comparison symbols and source names;
- caught errors in `check`, `compare`, and `history`;
- user-controlled paths printed after HTML/history writes;
- history symbols printed in headings and empty-history guidance;
- unknown rule IDs printed to stderr.

Trusted fixed messages, numeric counts, registry-owned rule metadata, and provider metadata need no transformation. JSON branches continue to call `JSON.stringify` directly. Markdown branches continue to call their Markdown renderers directly.

### Audit-history renderer

`formatHistory` is a human table renderer even though its entries originate in JSONL. It sanitizes the date and rule-ID cells before measuring widths and joining rows. `readHistory`, `appendHistory`, and the history JSON branch remain unchanged, preserving stored and machine-readable values.

### Markdown ownership

PR #227 removes its import of `escapeTerminalText` from `src/report/markdown.ts`. Markdown retains only its existing line, table-cell, and construct escaping. A regression test proves U+200B, ZWNJ, and ZWJ survive Markdown rendering so this branch composes with PR #239 rather than preempting it.

## Test strategy

- Unit-test complete CSI/OSC removal and visible encoding of each dangerous class without a raw-control regex.
- Unit-test preservation of multilingual text, emoji ZWJ sequences, U+200B, ZWNJ, ZWJ, and U+2060.
- Build a temporary CSV whose crafted header reaches `IngestError`, run the compiled CLI, and assert stderr is one inert logical line with exit code 2.
- Exercise successful table output and `compare` error output with crafted arguments/data while proving JSON retains original values.
- Exercise empty and populated history table output from a crafted symbol/hand-edited JSONL entry while proving history JSON retains original values.
- Exercise the unknown-rule diagnostic with a crafted ID.
- Retain Markdown's own escaping tests and add Unicode-preservation coverage.
- Run focused tests RED before implementation, then lint, typecheck, full tests, build, README smoke, changeset status, diff hygiene, and exact-head remote CI.

## Success criteria

- Every in-scope human stdout/stderr path renders crafted control-bearing input inert without changing exit codes or row/line structure.
- JSON and Markdown regressions prove their values are not passed through the terminal sanitizer.
- U+200B, U+200C, U+200D, U+2060, emoji, and multilingual text remain readable.
- `pnpm lint` passes with no disabled rule.
- The final diff contains no PR #231 work and no terminal-sanitizer change in `src/report/markdown.ts`.
