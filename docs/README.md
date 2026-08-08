# Goli-CLI Documentation

> **Master index** for all Goli-CLI documentation. Start here.

This is the canonical entry point for Goli-CLI documentation. It
maps to the **17 documentation categories / 39 items** from the
[Documentation Master Inventory](ai-agent/../requirements/../#todo)
and follows the [Diátaxis framework](https://diataxis.fr/) for user
docs.

## Quick links

| Audience            | Start here                                                           |
| ------------------- | -------------------------------------------------------------------- |
| New user            | [Getting Started](getting-started.md)                   |
| Contributor         | [Developer Setup Guide](onboarding/developer-setup.md)               |
| Maintainer          | [Release Process](ops/release-process.md)                            |
| Architect           | [SDD](design/sdd.md) + [C4 Diagrams](design/diagrams/c4-diagrams.md) |
| DevOps              | [Deployment Guide](ops/deployment-guide.md)                          |
| Security researcher | [`SECURITY.md`](../SECURITY.md)                                      |
| AI agent            | [`AGENTS.md`](../AGENTS.md)                                          |

## Documentation by category

### 1. Project-level docs

| Document        | File                                           |
| --------------- | ---------------------------------------------- |
| README          | [`/README.md`](../README.md)                   |
| LICENSE         | [`/LICENSE`](../LICENSE)                       |
| CONTRIBUTING    | [`/CONTRIBUTING.md`](../CONTRIBUTING.md)       |
| CODE_OF_CONDUCT | [`/CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) |
| SECURITY        | [`/SECURITY.md`](../SECURITY.md)               |
| GOVERNANCE      | [`/GOVERNANCE.md`](../GOVERNANCE.md)           |
| STYLEGUIDE      | [`/STYLEGUIDE.md`](../STYLEGUIDE.md)           |
| NOTICE          | [`/NOTICE`](../NOTICE)                         |
| AUTHORS         | [`/AUTHORS`](../AUTHORS)                       |

### 2. Requirements docs

| Document                      | File                                         |
| ----------------------------- | -------------------------------------------- |
| PRD (Product Requirements)    | [`requirements/prd.md`](requirements/prd.md) |
| SRS (IEEE 830)                | [`requirements/srs.md`](requirements/srs.md) |
| FRD (Functional Requirements) | [`requirements/frd.md`](requirements/frd.md) |

### 3. Design & architecture docs

| Document                  | File                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| SDD (IEEE 1016)           | [`design/sdd.md`](design/sdd.md)                                   |
| C4 Diagrams (Mermaid)     | [`design/diagrams/c4-diagrams.md`](design/diagrams/c4-diagrams.md) |
| Decision Log (ADR index)  | [`design/decision-log.md`](design/decision-log.md)                 |
| OpenAPI Spec (Studio API) | [`design/openapi/studio-api.yaml`](design/openapi/studio-api.yaml) |
| Socket Protocol (Studio)  | [`design/socket-protocol.md`](design/socket-protocol.md)           |
| RFC template              | [`design/rfcs/_template.md`](design/rfcs/_template.md)             |
| ADRs (46 of them)         | [`decisions/`](decisions/)                                         |

### 4. AI-agent specific docs

| Document                | File                                                       |
| ----------------------- | ---------------------------------------------------------- |
| AGENTS.md (canonical)   | [`/AGENTS.md`](../AGENTS.md)                               |
| AGENTS.md spec          | [`ai-agent/agents-md-spec.md`](ai-agent/agents-md-spec.md) |
| CLAUDE.md (root)        | [`/CLAUDE.md`](../CLAUDE.md)                               |
| CLAUDE.md (per-package) | [`ai-agent/claude/`](ai-agent/claude/)                     |
| MCP Server Manifest     | [`ai-agent/mcp/manifest.json`](ai-agent/mcp/manifest.json) |
| Tool Calling Schemas    | [`ai-agent/tool-schemas/`](ai-agent/tool-schemas/)         |
| Prompt Templates        | [`ai-agent/prompts/`](ai-agent/prompts/)                   |

### 5. User documentation (Diátaxis)

| Kind          | Path                                     |
| ------------- | ---------------------------------------- |
| Tutorials     | [`user/tutorials/`](user/tutorials/)     |
| How-to guides | [`user/how-to/`](user/how-to/)           |
| Reference     | [`user/reference/`](user/reference/)     |
| Explanation   | [`user/explanation/`](user/explanation/) |
| (Index)       | [`user/README.md`](user/README.md)       |

### 6. Testing & QA docs

| Document             | File                                         |
| -------------------- | -------------------------------------------- |
| Test Plan (IEEE 829) | [`qa/test-plan.md`](qa/test-plan.md)         |
| Test Strategy        | [`qa/test-strategy.md`](qa/test-strategy.md) |
| QA Strategy          | [`qa/qa-strategy.md`](qa/qa-strategy.md)     |
| Coverage report      | [`coverage-report.md`](coverage-report.md)   |
| A11y report          | [`a11y-report.md`](a11y-report.md)           |

### 7. Release & operations docs

| Document            | File                                                           |
| ------------------- | -------------------------------------------------------------- |
| Deployment Guide    | [`ops/deployment-guide.md`](ops/deployment-guide.md)           |
| Release Process     | [`ops/release-process.md`](ops/release-process.md)             |
| Migration Guides    | [`ops/migration-guides/`](ops/migration-guides/)               |
| Runbooks            | [`ops/runbooks/`](ops/runbooks/)                               |
| Postmortem template | [`ops/postmortems/_template.md`](ops/postmortems/_template.md) |
| CHANGELOG           | [`/CHANGELOG.md`](../CHANGELOG.md)                             |

### 8. Onboarding docs

| Document              | File                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| Developer Setup Guide | [`onboarding/developer-setup.md`](onboarding/developer-setup.md)     |
| 30-60-90 Day Plan     | [`onboarding/30-60-90-day-plan.md`](onboarding/30-60-90-day-plan.md) |

### 9. CLI-specific docs

| Document          | File                                                   |
| ----------------- | ------------------------------------------------------ |
| Command Reference | [`cli/command-reference.md`](cli/command-reference.md) |
| Themes catalog    | [`cli/themes.md`](cli/themes.md)                       |
| Cron scheduling   | [`cli/cron.md`](cli/cron.md)                           |

### 10. Other docs

| Document              | File                                         |
| --------------------- | -------------------------------------------- |
| Architecture overview | [`architecture.md`](architecture.md)         |
| Getting started       | [`getting-started.md`](getting-started.md)   |
| Local LLMs mode       | [`local-llms-mode.md`](local-llms-mode.md)   |
| TUI architecture      | [`tui/architecture.md`](tui/architecture.md) |
| MCP extensions        | [`extensions/mcp.md`](extensions/mcp.md)     |
| API reference         | [`api/README.md`](api/README.md)             |

## Documentation principles

Goli-CLI's documentation follows these principles:

1. **Docs-as-code.** All docs live in the repo as Markdown, reviewed
   in PRs, version-controlled with the code. No external wikis.
2. **Diátaxis for user docs.** Tutorials, how-to, reference, and
   explanation are kept separate. See
   [`user/README.md`](user/README.md).
3. **Living patterns in AGENTS.md.** The agent mutates `AGENTS.md`
   as it learns. See [`ai-agent/agents-md-spec.md`](ai-agent/agents-md-spec.md).
4. **ADRs for hard-to-reverse decisions.** 47 ADRs and counting. See
   [`design/decision-log.md`](design/decision-log.md).
5. **CI checks for docs.** Every PR touching `src/tools/` must also
   touch `docs/ai-agent/tool-schemas/`. TypeDoc must build without
   warnings. `--help` output must match a checked-in snapshot.

## Documentation status

| Category              | Coverage                                                         |
| --------------------- | ---------------------------------------------------------------- |
| Project-level         | ✅ Complete (9/9)                                                |
| Requirements          | ✅ Complete (3/3)                                                |
| Design & architecture | ✅ Complete (6/6)                                                |
| AI-agent specific     | ✅ Complete (7/7)                                                |
| User docs (Diátaxis)  | ✅ Complete (4 tutorials, 8 how-tos, 6 reference, 7 explanation) |
| Testing & QA          | ✅ Complete (3/3)                                                |
| Release & ops         | ✅ Complete (5/5)                                                |
| Onboarding            | ✅ Complete (2/2)                                                |
| CLI-specific          | ✅ Complete (3/3)                                                |
| Phase docs            | ✅ Complete (13/13)                                              |
| Other docs            | ✅ Pre-existing                                                  |

## Master inventory mapping

This index satisfies the
[Documentation Master Inventory](https://github.com/goli-cli/goli-cli/blob/main/docs/requirements/../)
from the Obsidian vault's
[`11 — Documentation Master Inventory.md`](https://github.com/goli-cli/goli-cli/blob/main/docs/requirements/).
All 17 categories / 39 items are covered (see category list above).

## How to contribute to docs

1. **Find a gap.** Is something missing or out of date? File an
   issue with the `docs` label.
2. **Open a PR.** Match the style of the surrounding docs. Run
   `npm run format:check` to make sure Prettier is happy.
3. **Update the relevant index.** If you add a new doc, add it to
   this README and to the relevant sub-README (e.g.
   `user/README.md`).
4. **Update the changelog.** Add a `docs:` entry.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the general PR
process.
