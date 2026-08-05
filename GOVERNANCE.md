# Governance

> **Status:** Draft v0.1 (pre-v1.0). This document will be ratified before the
> v1.0.0 release. Until then, the project lead (see `AUTHORS`) acts as the
> de-facto BDFL and the governance structure below is the target we are
> converging on.

This document describes how decisions are made in the Goli-CLI project, who
makes them, and how contributors can grow into maintainers and governance
roles. It is intentionally written **before** v1.0 so that the project
establishes its governance muscle while it is still small.

## 1. Roles

| Role                | How you get it                                                                                                                                                        | What you can do                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Contributor**     | Anyone who submits a PR, issue, doc, or design proposal that is merged or accepted.                                                                                   | Submit PRs, participate in design discussions, review others' PRs (non-binding).                         |
| **Triager**         | Demonstrated sustained issue-triage activity (≥30 days).                                                                                                              | Label and close issues, mark duplicates, escalate to maintainers, run `needs-triage` queue.              |
| **Maintainer**      | Demonstrated sustained, high-quality contribution to one or more packages (`core`, `cli`, `evals`, `vscode-ext`, `studio`) and the trust of two existing maintainers. | Approve and merge PRs in their area, cut releases in their package, block releases on quality grounds.   |
| **Lead Maintainer** | Elected by maintainers (annual vote, simple majority).                                                                                                                | Final call on cross-package disputes, release cadence, security disclosure handling, and policy changes. |
| **Emeritus**        | A maintainer who steps down voluntarily.                                                                                                                              | Retained as a non-voting advisor; can return to active maintainer status on request.                     |

The project has **one Lead Maintainer** at all times. If the Lead Maintainer
steps down or is inactive for >90 days, maintainers hold an election within
30 days.

## 2. Decision-making

We use a **lazy consensus** model with escalating formality:

1. **Discuss** — issues and design ideas are discussed in GitHub Issues or
   Discussions. Most decisions end here. After 72 hours with no objection,
   a discussion is considered to have lazy consensus.
2. **PR** — concrete changes go through PRs. A PR needs **one** maintainer
   approval (other than the author) for `docs/` and `tests/`, **two**
   approvals for `packages/*` source changes.
3. **ADR** — for decisions that are hard to reverse (architecture, public
   API, security model), the discussion must produce an Architectural
   Decision Record under `docs/decisions/`. ADRs follow the
   [MADR format](https://adr.github.io/madr/) and are numbered sequentially.
   See `docs/decisions/0001-sandbox-as-trust-boundary.md` for the template.
4. **RFC** — for changes that affect the user contract (CLI flags, file
   formats, config schema), an RFC Markdown file is committed under
   `docs/design/rfcs/` and discussed for at least 7 days before merge.

### 2.1 When formal votes happen

A formal vote (yes/no/abstain, simple majority wins) is required for:

- Electing or recalling the Lead Maintainer.
- Ratifying a new minor or major release (e.g. `0.x` → `1.0`, `1.x` → `2.0`).
- Amending this Governance document.
- Adopting or removing a top-level dependency (anything in the root
  `package.json` `dependencies`).
- Adding or removing a workspace package.

Votes are open for 7 days and are cast in a dedicated GitHub issue with
the `vote` label. Maintainers vote; contributors may post non-binding
opinions.

## 3. Packages and ownership

Each workspace package has at least one **maintainer of record** listed in
`packages/<pkg>/OWNERS` (a plain-text file, one GitHub handle per line).
Maintainers of record are the default reviewers for PRs touching their
package. Anyone can review any PR; the maintainers of record just own the
merge decision.

| Package               | Status            | Default reviewers   |
| --------------------- | ----------------- | ------------------- |
| `packages/core`       | Stable (Phase 2+) | Core maintainers    |
| `packages/cli`        | Stable (Phase 2+) | CLI maintainers     |
| `packages/evals`      | Stable            | Eval maintainers    |
| `packages/vscode-ext` | Experimental      | VS Code maintainers |
| `packages/studio`     | Experimental      | Studio maintainers  |

A package may be **archived** (no new features, only security fixes) or
**deprecated** (frozen) by a maintainer vote. Archived packages are marked
in their `package.json` `description` and in the root README.

## 4. Security disclosure

Security vulnerabilities are **not** reported via public GitHub issues.
See [`SECURITY.md`](SECURITY.md) for the private disclosure process. The
Lead Maintainer is the default security contact; a dedicated security
maintainer may be appointed by vote.

The project follows a **90-day disclosure deadline**: after a
vulnerability is reported, we have 90 days to ship a fix before the
reporter is free to disclose publicly. Extensions are granted case-by-case.

## 5. Code of Conduct

Participation in the Goli-CLI community is governed by the
[Contributor Covenant 2.1](CODE_OF_CONDUCT.md). The Lead Maintainer and a
COC working group of 2–3 maintainers (rotating annually) handle
enforcement. Reports go to **conduct@goli-cli.dev**.

## 6. Conflict of interest

Maintainers recuse themselves from votes or decisions where they have a
material conflict of interest (e.g. their employer has a competing product,
they have a personal relationship with a contributor under review).
Disclosure is mandatory; the recused maintainer may still comment
non-bindingly.

## 7. Amendments

This document is amended by formal maintainer vote (7 days, simple
majority). The `GOVERNANCE.md` history is tracked in git; a
`CHANGELOG-governance.md` section in `CHANGELOG.md` records material
amendments.

## 8. License & IP

All contributions are licensed under the [MIT License](LICENSE). The
project requires a Developer Certificate of Origin (DCO) sign-off on every
commit (`Signed-off-by: Name <email>`). The `NOTICE` file lists
third-party notices; contributors are responsible for disclosing
third-party code in their PRs.

The project's AI authorship policy is documented in
[`docs/decisions/0008-ai-authorship-policy.md`](docs/decisions/0008-ai-authorship-policy.md)
— AI-generated contributions are welcome but must be reviewed and
signed-off by a human who takes responsibility for them.
