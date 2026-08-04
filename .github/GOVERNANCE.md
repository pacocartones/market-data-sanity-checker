# Governance

## Project Philosophy

`market-data-sanity-checker` is a **community-driven, meritocratic open source project** under the MIT license. We prioritize:

1. **Trust & accuracy** — Every rule backed by real incidents or academic literature
2. **Transparency** — All decisions documented, roadmap public
3. **Inclusivity** — Welcoming contributors of all backgrounds and skill levels
4. **Quality over speed** — Rigorous review process for rule additions
5. **Academic rigor** — Partnership with research community

## Project Structure

### Maintainer
- **Manuel Sánchez** (@pacocartones) - Creator, lead maintainer, final decision authority

### Core Contributors
Contributors who have made significant, sustained contributions may be invited to become core contributors with expanded permissions:
- Review and merge PRs
- Triage issues
- Shape roadmap direction

**Current core contributors:** (To be established as community grows)

### Community Contributors
Anyone who contributes code, documentation, bug reports, or participates in discussions.

## Decision Making

### Standard Changes
Day-to-day decisions (bug fixes, docs, minor features) follow standard PR review:
1. Submit PR with clear description
2. Automated checks pass (CI, lint, tests)
3. At least one approval from maintainer/core contributor
4. Merge

### Significant Changes
Changes that affect architecture, APIs, or project direction require broader consensus:
- **Rule additions** — Must follow [CONTRIBUTING.md](CONTRIBUTING.md) contract (stable ID, severity, reference, fixture, explanation)
- **Breaking changes** — Require RFC (Request for Comments) issue, 1-week discussion period minimum
- **Dependency additions** — Require justification, security review, and impact assessment
- **Roadmap changes** — Discussed in GitHub Discussions, documented in `.internal/ROADMAP.md`

### Conflict Resolution
1. **Discussion** — Open issue or discussion thread
2. **Consensus building** — Gather input from community and core contributors
3. **Maintainer decision** — If consensus not reached, maintainer makes final call
4. **Documentation** — Decision and rationale documented publicly

## Contribution Workflow

### For first-time contributors:
1. Browse "good first issue" labels
2. Comment on issue expressing interest
3. Fork, branch, implement with tests
4. Submit PR referencing issue
5. Respond to review feedback
6. Celebrate your merged contribution! 🎉

### For recurring contributors:
1. Pick from roadmap or propose new feature via issue first
2. Get alignment before significant work
3. Follow existing code style and patterns
4. Ensure test coverage >80% for new code
5. Update docs if user-facing changes

### For rule additions:
See detailed requirements in [CONTRIBUTING.md](CONTRIBUTING.md):
- Stable rule ID (SCREAMING_SNAKE_CASE)
- Documented severity with rationale
- Real-world incident or academic reference
- Test fixture reproducing the problem
- Clear explanation with causal hypothesis

## Code Review Standards

Reviewers will assess:
- **Correctness** — Does it solve the problem without introducing bugs?
- **Test coverage** — Are edge cases tested? Does coverage meet threshold?
- **Code quality** — Is it readable, maintainable, following project patterns?
- **Documentation** — Are user-facing changes documented?
- **Performance** — No regressions in benchmarks
- **Security** — No vulnerabilities introduced

## Release Process

We use [Changesets](https://github.com/changesets/changesets) for versioning:

1. **PR includes changeset** — Author runs `pnpm changeset` and commits the generated file
2. **Changesets bot** creates release PR automatically
3. **Maintainer reviews** — Ensures CHANGELOG quality, version bump correct
4. **Merge triggers release** — Automated via GitHub Actions
5. **npm publish** — With provenance attestation
6. **GitHub release** — Auto-generated with notes

### Versioning (Semantic Versioning)
- **Patch (1.1.x)** — Bug fixes, docs, non-breaking changes
- **Minor (1.x.0)** — New rules, features, non-breaking additions
- **Major (x.0.0)** — Breaking API changes, removed features

## Community Guidelines

### Code of Conduct
We follow the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Key points:
- Be respectful and inclusive
- Assume good intentions
- Provide constructive feedback
- No harassment, discrimination, or toxic behavior

### Communication Channels
- **GitHub Issues** — Bug reports, feature requests
- **GitHub Discussions** — Questions, ideas, showcase
- **Pull Requests** — Code contributions
- **Security Advisories** — Private vulnerability reports (see [SECURITY.md](SECURITY.md))

### Response Times
We strive for:
- **Issues** — Acknowledgment within 48 hours
- **PRs** — Initial review within 1 week
- **Security reports** — Acknowledgment within 7 days

These are goals, not guarantees — this is a volunteer-run project.

## Recognition

Contributors are recognized via:
- **All Contributors** — Listed in README with contribution types
- **Release notes** — Credited in CHANGELOG
- **GitHub contributors page** — Automatic tracking
- **Special mentions** — Significant contributions highlighted in project updates

## Governance Evolution

This governance model will evolve as the community grows:
- **<10 contributors** — Current model (maintainer-led)
- **10-50 contributors** — Establish core contributor team
- **50+ contributors** — Consider steering committee or foundation model

Changes to this document require:
1. RFC via GitHub Discussion
2. 2-week comment period
3. Maintainer approval
4. Documentation of decision rationale

## License & Intellectual Property

- **Code license** — MIT (see [LICENSE](LICENSE))
- **Contribution license** — By contributing, you agree your code is licensed under MIT
- **Copyright** — Contributors retain copyright, grant project perpetual license
- **Patents** — Contributors grant patent license per MIT terms
- **Trademarks** — "market-data-sanity-checker" name and logo (if created) remain with project

## Questions?

Open a [GitHub Discussion](https://github.com/pacocartones/market-data-sanity-checker/discussions) or reach out to the maintainer.

---

**Last updated:** 2026-08-04  
**Status:** Living document, open to community feedback
