# Security Policy

## Supported Versions

Only the latest major release line receives security fixes. If a fix lands, it ships
as a patch on that line — upgrade to stay covered.

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Scope

This policy covers **`market-data-sanity-checker` itself** — the library, the `mdsc`
CLI, and the code in this repository (including the HTML report renderer, parsers
and provider connectors).

It does **not** cover:

- **The market data itself.** Wrong, stale or manipulated data from Yahoo, Alpha
  Vantage or any other provider is what this tool *detects* — report bad data to
  your provider, not to us.
- **Third-party provider APIs and infrastructure.** Outages, auth issues or
  vulnerabilities on a provider's side belong to that provider.
- Vulnerabilities in dependencies that already have an upstream fix — run
  `pnpm update` / watch Dependabot PRs first.

## Reporting a Vulnerability

Please report vulnerabilities **privately** through GitHub Security Advisories:

[Report a vulnerability](https://github.com/pacocartones/market-data-sanity-checker/security/advisories/new)

Do **not** open a public issue for a security problem. A corrupted datum must never
become executable markup — if you found a way to break that promise (XSS in the HTML
report, path traversal in file ingestion, credential leaks through connectors,
supply-chain tampering with the release pipeline, …), we want to hear about it
before it becomes public.

Include, when you can:

- the affected version and how you installed the tool (`npm`, `pnpm`, from source);
- a minimal reproduction — input file, command or API call;
- the impact you see (what an attacker could do with it).

## What to Expect

- **Acknowledgement within 7 days.** This is a spare-time open source project; the
  report is read by a human, just not on an SLA.
- If the report is accepted, we work on a fix, credit you in the advisory (unless
  you prefer otherwise) and coordinate a disclosure date with you.
- If it is declined (out of scope, not reproducible, intended behavior), we explain
  why in the advisory thread.

Thank you for helping keep the trust layer trustworthy.
