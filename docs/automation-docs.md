# API Docs automation activation

The workflow keeps push/main and manual/main and checks out the event SHA. It rejects other refs/repositories/events and rechecks the current main SHA before publication.

This code is disabled until the repository variable DOCS_AUTOMATION_READY is exactly true. An absent flag fails before build or environment jobs; it is an operator activation acknowledgement, not an independent authorization policy.

Before a maintainer activates it, separately approve and verify:
- github-pages allows only the intended main branch; inventory any legitimate gh-pages deployment first.
- main updates require a PR and the intended human writer, with no automation bypass; keep required checks.
- a non-main ref and an old token cannot publish through another workflow definition.

No settings are configured by this change. Local guards do not govern historical definitions. Source/main checks and deployment are separate operations, not an atomic transaction. If main advanced, start a new run. Coverage remains optional for docs availability and only a successful measurement refreshes the badge.
