# Release & Operations Documents

This directory holds the **operational** docs for Goli-CLI: runbooks
(for incidents), deployment guides, migration guides (for upgrading
between versions), and postmortem templates.

| Document            | File                                                 | Audience                   |
| ------------------- | ---------------------------------------------------- | -------------------------- |
| Deployment Guide    | [deployment-guide.md](deployment-guide.md)           | DevOps, platform engineers |
| Migration Guides    | [migration-guides/](migration-guides/)               | Upgraders                  |
| Runbooks            | [runbooks/](runbooks/)                               | On-call SREs               |
| Postmortem template | [postmortems/_template.md](postmortems/_template.md) | Authors of postmortems     |
| Release process     | [release-process.md](release-process.md)             | Maintainers                |

## Quick links

- [CHANGELOG.md](../../CHANGELOG.md) — per-version change log.
- [`infra/`](../../infra/) — k8s + docker-compose manifests.
- [`SECURITY.md`](../../SECURITY.md) — security disclosure process.
- [Runbook: agent-stuck-in-loop.md](runbooks/agent-stuck-in-loop.md)
- [Runbook: sandbox-escape-alert.md](runbooks/sandbox-escape-alert.md)
- [Runbook: provider-outage.md](runbooks/provider-outage.md)
