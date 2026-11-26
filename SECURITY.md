# Security policy

## Reporting a vulnerability

Please do **not** open a public issue, pull request or discussion for a security problem.

Report it privately through the repository's **Security** tab: [**Report a vulnerability**](https://github.com/pacocartones/market-data-sanity-checker/security/advisories/new) ([GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)). If you can't use GitHub advisories, email **admin@tweakeo.com** instead.

A corrupted datum must never become executable markup. If you found a way to break that promise (XSS in the HTML report, path traversal in file ingestion, credential leaks through connectors, supply-chain tampering with the release pipeline, …), we want to hear about it before it becomes public. Include, when you can:

- the affected version and how you installed the tool (`npm`, `pnpm`, from source);
- a minimal reproduction: input file, command or API call;
- the impact you see (what an attacker could do with it);
- any fix or mitigation you suggest.

## What to expect

- **Acknowledgement within 48 hours (best effort).** This is a spare-time open source project; the report is read by a human, just not on an SLA.
- If the report is accepted, a fix is prepared in private and a security advisory is published with credit to you (unless you prefer to stay anonymous), on a disclosure date agreed with you.
- If it is declined (out of scope, not reproducible, intended behavior), we explain why in the advisory thread.

## Supported versions

Only the latest major release line receives security fixes. A fix ships as a patch on that line; upgrade to stay covered.

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Scope

In scope: **`market-data-sanity-checker` itself**: the library, the `mdsc` CLI, the GitHub Action, and the code in this repository (including the HTML report renderer, parsers and provider connectors) and its GitHub Actions workflows (`.github/workflows/`).

Out of scope:

- **The market data itself.** Wrong, stale or manipulated data from Yahoo, Alpha Vantage or any other provider is what this tool *detects*: report bad data to your provider, not to us. A wrong rule reference or incident fact is a correction: use the data correction issue form.
- **Third-party provider APIs and infrastructure.** Outages, auth issues or vulnerabilities on a provider's side belong to that provider.
- Vulnerabilities in dependencies that already have an upstream fix: run `pnpm update` or watch the Dependabot pull requests first. Others go upstream.

## Automation and permissions

Every action is pinned by full commit SHA, and [zizmor](https://github.com/zizmorcore/zizmor) audits the workflows on every pull request. Workflows grant read-only or no permissions at the top and add only what each job needs. No workflow that checks out or runs pull-request code has write permissions or repository secrets. The shared reusable workflows and their rules live in [`pacocartones/.github`](https://github.com/pacocartones/.github#security-rules).

Thank you for helping keep the trust layer trustworthy.
