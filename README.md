# GOLI-CLI

> **Enterprise AI coding agent built in TypeScript — multi-provider, open-weight-first.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: 20+](https://img.shields.io/badge/node-%E2%89%A520.18-brightgreen)](package.json)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-%E2%89%A55.7-blue)](package.json)
[![Phase: 2](https://img.shields.io/badge/Phase-2%20Agent%20Loop-blue)](PLAN.md)
[![Tests: 3053](https://img.shields.io/badge/tests-3053%20passing-brightgreen)](tests/)
[![Version: 0.2.0-phase2](https://img.shields.io/badge/version-0.2.0--phase2-blueviolet)](package.json)

> **Documentation:** [CHANGELOG.md](CHANGELOG.md) · [API Reference](docs/api/_generated/index.html) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Agent Guide](AGENTS.md) · [MCP Extensions](docs/extensions/mcp.md)

GOLI-CLI is an enterprise-grade AI coding agent — a CLI/TUI autonomous
coding assistant — with a pluggable multi-provider model layer. The
default backend is **Ollama Cloud (`ollama/gpt-oss:120b`)**, an
open-weight model that keeps you free of closed-vendor ToS restrictions.
It implements a 7-module architecture across 13 implementation phases:

| Module | Purpose                                             | Phase  |
| ------ | --------------------------------------------------- | ------ |
| 1      | Agent Core Loop (ReAct + multi-provider client)     | P2     |
| 2      | Context Engine (tree-sitter + hybrid retrieval)     | P7     |
| 3      | Tool Layer & MCP (tools + deterministic hooks)      | P4, P6 |
| 4      | Sandboxing & Execution (kernel-enforced)            | P5     |
| 5      | Memory & Self-Improvement (3-tier + SICA)           | P8–P11 |
| 6      | Evals & Observability (SWE-bench + OTel + Langfuse) | P12    |
| 7      | Multi-Agent Orchestration (worktrees + LiteLLM)     | P13    |

---

## Current Status: Phase 2 (Agent Loop + TUI) ✅

Phase 2 delivers a runnable agent loop, a pluggable provider system, and
a mature TUI polished across **35+ iterations** with **3053 tests
passing** and **0 regressions**. See [PLAN.md](PLAN.md) for the full
13-phase breakdown.

### Provider System

Goli-CLI ships an integrated providers module
([`packages/core/src/providers/`](packages/core/src/providers/)) that
abstracts LLM access behind a single `ModelProvider` interface. The
runtime selects the backend from the `GOLI_DEFAULT_MODEL` env var (set
in `.env`):

| Provider  | Spec prefix  | Default model                  | Notes                                        |
| --------- | ------------ | ------------------------------ | -------------------------------------------- |
| Ollama    | `ollama/`    | `ollama/gpt-oss:120b` (default)| Ollama Cloud; open-weight                    |
| OpenAI    | `openai/`    | `openai/gpt-4o`                | Requires `OPENAI_API_KEY`                    |
| Anthropic | `anthropic/` | `anthropic/claude-3-5-sonnet`  | Requires `ANTHROPIC_API_KEY`                 |
| Gemini    | `gemini/`    | `gemini/gemini-1.5-pro`        | Requires `GEMINI_API_KEY`                    |
| Mock      | `mock/`      | `mock/echo`                    | Deterministic; used by `--demo` mode & tests |

A `.env` file with the Ollama Cloud config is shipped in the repo root —
no external `dotenv` dependency is required (the loader reads `.env`
directly). Add API keys for any providers you want to use beyond Ollama.

### TUI Features (35+ iterations)

The Goli-CLI TUI is built with [Ink](https://github.com/vadimdemedes/ink)
(React for CLIs). After the splash screen, only **HeaderBar +
HistoryScroll + PromptInput/StatusBar** are visible — down from 7+ bars
in earlier iterations. `AgentStateBar`, `ApprovalModeIndicator`,
`ContextSummaryDisplay`, and `ShortcutsHelp` are wired but removed from
the chat surface for performance.

**Theming & Visuals**

- **20 built-in themes** + live hot-reload (no restart needed) + skin border styles — `/theme` opens the `ThemeDialog`
- `resolveColor()` 256/16-color downsampling for older terminals
- WCAG AA accessibility across all themes; 2 colorblind-accessible themes

**Dialogs & Overlays**

- `DiffReviewDialog` — diff-before-approve for `edit_file` / `write_file`
- `DialogManager` orchestrates `ThemeDialog`, `AboutDialog`, `PermissionDialog`, `HelpDialog`
- `CommandPalette` (Ctrl+P) — fuzzy command launcher
- `LoadingIndicator`, `ApprovalModeIndicator`, `ContextSummaryDisplay`, `ShortcutsHelp` (wired)

**Input & Editing**

- Full **vim mode** — INSERT/NORMAL/VISUAL with `h/j/k/l`, `dd`, `i/a/A/I/o/O`, `v`
- `@` file-path Tab completion + `!` shell Tab completion (git/npm subcommands)
- Paste placeholder collapse (`[Pasted Text: N lines]` + Ctrl+O expand)
- Unicode code-point cursor (emoji/CJK-safe)
- Undo/redo (Ctrl+Z / Ctrl+Y)
- Word-boundary navigation (Ctrl+W, Ctrl+U)
- Persistent input history (`~/.goli/history`)
- Kitty keyboard protocol detection

**Keybindings**

- Ctrl+L clear screen · Ctrl+R reverse-search · Ctrl+P command palette · Ctrl+O `$EDITOR`
- Mouse scroll support (Ctrl+S toggle)
- Dense/compact tool mode (`GOLI_TUI_DENSE_TOOLS=1`)
- Tool expand-toggle (`/expand`)

**Slash Commands**

`/theme` · `/about` · `/help` · `/expand` · `/allowlist` · `/queue` ·
`/cost` · `/context` · `/bg` · `/tips` · `/doctor` · `/shortcuts`
— plus slash-command autocomplete (type `/`, navigate ↑/↓, accept
Tab/Enter).

**Context, Tips & Background**

- Real context counts via the `useContextCounts` hook
- 115 curated tips across 4 categories (`/tips`)
- Background shell registry + `/bg` command
- `.env` auto-loading (no external `dotenv` dependency)

**Rendering**

- 8 specialized message renderers — User, Agent, System, Tool, Thinking, Error, Warning, Hint
- Markdown rendering — bold, italic, code, code blocks, headings, nested lists, blockquotes, GFM tables, links
- 5 spinner styles — dots, line, arrow, bounce, triangle
- Toast notifications — Ctrl+C twice / Esc twice confirmation
- Screen-reader mode — auto-detected linear layout

See [docs/tui/architecture.md](docs/tui/architecture.md) for the full component tree and [docs/cli/themes.md](docs/cli/themes.md) for the theme catalog.

### Quick Start

```bash
# Clone (or download the release tarball)
git clone https://github.com/goli-cli/goli-cli.git
cd goli-cli

# Install dependencies
npm install

# Build all workspaces (packages/core, packages/cli, packages/evals)
npm run build

# A .env file with Ollama Cloud config is already included.
# Launch the TUI (uses ollama/gpt-oss:120b by default):
npm run goli -- wakeup

# Demo mode — no API key needed (uses the Mock provider):
npm run goli -- --demo -p "hello"

# Health check — verifies config, providers, sandbox, and runtime deps:
npm run goli -- doctor

# Verify version & full grouped help:
npm run goli -- --version   # → goli-cli 0.2.0-phase2 — Multi-Agent Software Swarm
npm run goli -- --help

# Optional: verify the clean-room install flow end-to-end
bash scripts/clean-room-verify.sh

# Optional: typecheck + lint + format:check + test
npm run verify
```

> **No Ollama Cloud key?** Use `--demo` (or set `GOLI_DEFAULT_MODEL=mock/echo`) to exercise the agent loop end-to-end without any network calls.

### Common Commands

| Command              | What it does                             |
| -------------------- | ---------------------------------------- |
| `npm run build`      | Compile TypeScript to `dist/`            |
| `npm run dev`        | Run CLI in dev mode (tsx)                |
| `npm run goli`       | Run the built `goli` binary              |
| `npm run typecheck`  | `tsc --noEmit` (strict)                  |
| `npm run lint`       | ESLint                                   |
| `npm run format`     | Prettier write                           |
| `npm test`           | Vitest unit + integration (3053 tests)   |
| `npm run test:e2e`   | Vitest e2e (slow)                        |
| `npm run verify`     | typecheck + lint + format:check + test   |
| `npm run sbom:check` | Syft + Trivy SBOM policy (zero GPL/AGPL) |

---

## Documentation

| Document                           | What's in it                                     |
| ---------------------------------- | ------------------------------------------------ |
| [PLAN.md](PLAN.md)                 | 13-phase implementation plan with steps          |
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level architecture + module map             |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Coding standards, PR process, AI-assist policy   |
| [SECURITY.md](SECURITY.md)         | Threat model, vuln disclosure, incident response |
| [docs/decisions/](docs/decisions/) | Architectural Decision Records (ADRs)            |
| [docs/phases/](docs/phases/)       | Per-phase detailed step lists                    |
| [docs/modules/](docs/modules/)     | Per-module deep dives (added as each lands)      |
| [docs/extensions/mcp.md](docs/extensions/mcp.md) | MCP extension API + hello-world example (A8) |
| [docs/architecture.md](docs/architecture.md) | High-level architecture + 11-agent pipeline map |
| [docs/getting-started.md](docs/getting-started.md) | 5-minute tutorial |
| [docs/agents.md](docs/agents.md) | Per-agent reference (Scout → Documenter) |
| [docs/tui/architecture.md](docs/tui/architecture.md) | TUI component tree + state model |
| [docs/cli/themes.md](docs/cli/themes.md) | Theme catalog (20 built-in + user YAML skins) |
| [docs/coverage-report.md](docs/coverage-report.md) | Test coverage report + gap analysis |

---

## Why GOLI-CLI?

The market has Claude Code, Codex, Cursor, Gemini CLI, Aider — why build
another? Three reasons, all architectural:

1. **Open-weight model choice future-proofs against ToS restrictions.**
   The default backend (`ollama/gpt-oss:120b`) is open-weight.
   Closed-weight vendors (Anthropic, OpenAI) have ToS clauses barring use
   of their APIs to build competing products — already enforced against
   OpenAI (Aug 2025) and xAI/Cursor (Jan 2026). GOLI-CLI never wires a
   closed-weight model as default, but lets you opt in via
   `GOLI_DEFAULT_MODEL` when needed.

2. **Self-hosting preserves data sovereignty.** Open weights can be
   self-hosted on owned GPU infra (8×H100/H200, FP8). No data egress.
   Critical for GDPR, EU AI Act, and enterprise customer DPAs.

3. **Weight-level fine-tuning compounds the advantage.** Open licenses
   permit fine-tuning. Module 5's GRPO + LoRA pipeline + SICA recursive
   self-improvement loop are structurally impossible with closed-weight
   competitors. The trajectory data, the fine-tuned adapters, and the
   skill library are the moat.

See `docs/source-roadmap/enterprise-ai-coding-agent-roadmap.md` for the
full legal register (15 issues, 10 solved by architecture, 5 flagged
with owners and timelines).

---

## Compliance Posture

GOLI-CLI is designed to satisfy five compliance gates, layered into the
phases:

| Gate | Phase | Assertion                                                | Status |
| ---- | ----- | -------------------------------------------------------- | ------ |
| G1   | P1    | MIT license + attribution in repo root                   | ✅     |
| G2   | P1    | SBOM clean (zero GPL/AGPL) in CI                         | ✅     |
| G3   | P5    | Self-hosted open-weight path documented (post-prototype) | ⏳     |
| G4   | P7    | Authorship ledger live (every tool call → human review)  | ⏳     |
| G5   | P11+  | Liability shield (ToS + insurance + audit log)           | ⏳     |

---

## License

MIT — see [LICENSE](LICENSE). The default model backend
(`ollama/gpt-oss:120b`) is open-weight. See [NOTICE](NOTICE) for
attribution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: fork →
branch → `npm run verify` → PR. Every PR must pass CI (lint, typecheck,
unit tests, SBOM gate). AI-assisted PRs are welcome iff a human author
signs off.
