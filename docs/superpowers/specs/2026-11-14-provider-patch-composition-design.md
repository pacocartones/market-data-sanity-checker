# Provider Patch Composition Design

## Intent

Compose security patches #228 and #237 on current `main` without rewriting their original commits or authors. The combined result must bound provider response work, redact provider-controlled Alpha Vantage failure details, and prove the final CLI and scoreboard output is credential-safe without contacting a provider or using a real credential.

## Goals

- Preserve original commits `5233b9b` (#228) and `cb63920` (#237) as ancestors.
- Establish #228 before #237 in the integration history.
- Replace the stale `.json()`-only parser-failure double with a real `Response` body containing invalid JSON and a synthetic secret.
- Assert the exact public error category and the absence of the synthetic secret.
- Exercise the compiled CLI stderr and the scoreboard's final fetch-failure log.
- Update existing draft branches only through normal fast-forward pushes.

## Non-goals

- No compatibility layer for partial `FetchLike` or `ResponseLike` objects.
- No live Alpha Vantage or Yahoo requests and no real credentials.
- No new response limits, diagnostic categories, public APIs, scan, release, merge, or issue closure.

## Contract finding

`Connector.fetchDaily` calls the platform `fetch` global, whose return type is the standard `Response`. The package exports `Connector`, `FetchOptions`, and the connector objects, but no injectable fetch interface or response-like type. Objects exposing only `.json()` occur solely in local Vitest helpers. Supporting them would create a new contract and allow tests to bypass #228's bounded `response.body` reader.

## Approaches considered

1. **Only replace #237's stale mock.** Smallest diff, but it would not prove that CLI stderr or scoreboard logs receive only the safe payload.
2. **Teach `readProviderJson` to fall back to `.json()`.** Rejected because `.json()`-only objects are not a supported public contract and the fallback would bypass the byte bound.
3. **Use real responses and test the actual callers.** Selected. A real invalid response proves the joint parser path; a Node preload exercises the compiled CLI without network; a stubbed in-process scoreboard run observes the final log without writing outputs.

## Design

First merge current `main` into #228. From that head, add failing regression tests for the real invalid-response path, compiled CLI stderr, and scoreboard log. Then merge the original #237 commit and resolve overlapping Alpha Vantage tests by retaining #228's real `Response` fixtures plus the new exact redaction assertions. Existing successful real-response tests are the legitimate control for valid sub-limit input; existing timeout tests retain their distinct static category.

The scoreboard test stubs `fetch`, timers, console methods, and `process.exit`. Yahoo fails with a synthetic non-secret transport error; Alpha Vantage receives invalid JSON containing a synthetic secret. Both providers fail quorum, so the script exits before writing scoreboard artifacts. The assertion targets the full Alpha Vantage log line and scans all captured logs for the secret.

## Constraints

- Preserve Paco Cartones as author of both original commits.
- Never force-push; verify each remote head immediately before a normal push.
- Keep the original risk assessments immutable and write a new composition/fix report.
- Run focused red/green tests, then the repository test suite, typecheck, lint, build, and commit-policy checks on the exact combined head.
- Obtain an independent read-only review before updating drafts.

