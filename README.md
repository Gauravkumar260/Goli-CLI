# Goli-CLI

> A TypeScript AI coding agent with an Ink (React) TUI — my college side project.
> Open-weight-first, npm-workspaces monorepo, published to npm as
> [`@goli-cli/cli`](https://www.npmjs.com/package/@goli-cli/cli).

[![npm](https://img.shields.io/npm/v/@goli-cli/cli.svg)](https://www.npmjs.com/package/@goli-cli/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: 20+](https://img.shields.io/badge/node-%E2%89%A520.18-brightgreen)](package.json)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-%E2%89%A55.7-blue)](package.json)
[![Tests: 3342](https://img.shields.io/badge/tests-3342-brightgreen)](docs/coverage-report.md)
[![Version: 0.3.0](https://img.shields.io/badge/version-0.3.0-blueviolet)](package.json)
[![Studio: experimental](https://img.shields.io/badge/studio-experimental-orange)](apps/studio/README.md)

🚧 **Active student project** – built in my free time while juggling classes.
Feedback and bug reports are very welcome, but expect some rough corners.

---

**Documentation:** [CHANGELOG.md](CHANGELOG.md) · [API Reference](docs/api/README.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Agent Guide](AGENTS.md) · [Docs Index](docs/README.md)

---

Goli is an agentic coding assistant I'm building as a personal side
project: a terminal UI that plans, edits files, runs shell commands, and
iterates on a codebase with an LLM behind it. It's a learning project as
much as a tool — every loop of the repo has pushed the TUI, tool sandbox,
multi-provider layer, memory, and multi-agent orchestration into
something that actually runs.

The default backend is **Ollama (`ollama/gpt-oss:120b-cloud`)** — an
open-weight model. Point it at a **local Ollama** server (no key
needed) or Ollama Cloud with a free key; the provider layer also adds
Anthropic, Gemini, and OpenAI-compatible endpoints without locking you
to one vendor.

**Status:** active-development student side project. Things move, some
corners are rough, and I document the honest gaps. The test suite is
large because I lean on it to survive my own refactors.

## Features

### Agent core & providers

- **ReAct-style agent loop** with systematic planning, tool calling, and
  per-mode tool filtering (read-only / plan / build / god / local-llms).
- **Pluggable multi-provider layer** (`packages/llm-providers`): Ollama
  (default), Anthropic, Gemini, plus a router. OpenAI is hard-blocked in
  this build. No mock/demo provider — the loop always talks to a real
  backend.
- **Sandboxed execution** — `read-only` / `workspace-write` /
  `danger-full-access` modes; `GOLI_SANDBOX=local|docker`; Linux
  sandboxing via bubblewrap. Path safety + a denylist for destructive
  commands.
- **MCP support** — connect external tool servers (`goli mcp add/remove/list/scan`).
- **Memory** — session memory, a recursive self-improvement system
  (SICA), and a skill catalog that extracts reusable skills from
  successful trajectories (L1/L2 progressive disclosure).
- **Multi-agent orchestration** — an agent-swarm pipeline
  (scout → researcher → architect → planner → implementer → debugger →
  qa → reviewer → documenter) with parallel sub-agents, worktrees, and a
  shared blackboard.

### TUI Features (Ink/React)

- **25 built-in themes** (Tokyo Night, Dracula, Solarized, GitHub, Nord,
  Monokai, Ayu, colorblind-safe variants; WCAG AA contrast across
  themes) plus user YAML skins in `~/.goli/skins/` — live hot-reload
  via `/theme`.
- **Vim mode** input (INSERT/NORMAL/VISUAL), slash-command autocomplete,
  `@`-file and `!`-shell completion, undo/redo.
- **Markdown rendering** for agent messages — bold, lists, code blocks,
  tables, 8 message renderers, 5 spinner styles. Toast notifications for
  transient state; screen-reader mode and WCAG AA contrast where
  supported (`NO_COLOR` aware).
- **Persistent input history** (`~/.goli/history`), reverse-search, mouse
  scroll, dense-tool mode.
- `DiffReviewDialog` — see the diff before approving `edit_file`/`write_file`.

See [docs/tui/architecture.md](docs/tui/architecture.md) for the
component tree and [docs/cli/themes.md](docs/cli/themes.md) for the
skin catalog.

### Slash commands

Mode & review: `/help` · `/mode build|plan|god|safe` (+ aliases
`/plan`, `/build`, `/godmode`, `/safemode`) · `/tier` · `/theme` ·
`/design` · `/clear` · `/compact` · `/expand` · `/allowlist`
Context & memory: `/context` · `/memory` · `/skills` (incl. `archive`) ·
`/sica` · `/model` · `/cost`
TUI & misc: `/vim` · `/copy` · `/shortcuts` · `/stats` · `/audit` ·
`/queue` · `/bg` · `/tips` · `/doctor` · `/mcp` · `/quit` — plus a few
debug helpers (`/echo`, `/btw`, `/inputmode`). Type `/` in the TUI to
auto-complete them. See the "Slash Commands" section of
[docs/cli/command-reference.md](docs/cli/command-reference.md).

### Headless / CI

- `goli -p "..."` — run a prompt and print the result to stdout, exit. Great for scripts/CI.
- `goli --local-llms` — a three-axis router (sensitivity / complexity / availability) across local Ollama workers + cloud.
- `goli doctor` — config / provider / sandbox health check.
- `goli cron` — schedule agent runs.

---

## Monorepo layout

npm workspaces + [Turborepo](https://turborepo.com/); `apps/` for
interfaces, `packages/` for shared libraries.

| Path                       | What's in it                                               |
| -------------------------- | ---------------------------------------------------------- |
| `apps/cli/`                | The main TUI/CLI (`goli`)                                  |
| `apps/studio/`             | **Experimental** Next.js web console (SSE, chat, sessions) |
| `apps/vscode-ext/`         | VS Code companion extension (batch diff review, audit log) |
| `packages/agent-core/`     | Agent loop, prompt builder, compression, skill loader      |
| `packages/llm-providers/`  | `ModelProvider`, router, Ollama/Anthropic/Gemini/OpenAI    |
| `packages/tool-system/`    | Tool registry, execution hooks, +20 tools                  |
| `packages/sandbox/`        | Sandbox enforcement, path checks, cgroups                  |
| `packages/context-engine/` | Codebase indexing, retrieval, symbol scanning              |
| `packages/memory-engine/`  | Session memory, SICA, skills, FTS5 search                  |
| `packages/orchestration/`  | Swarm pipeline, sub-agents, worktrees, blackboard          |
| `packages/config/`         | Config loading, mode prompt fragments, CLI args            |
| `packages/observability/`  | Audit log, metrics, tracing                                |
| `packages/evals/`          | Golden-set evaluation harness (SWE-bench, semantic checks) |
| `packages/approval/`       | Human-approval gates, destructive-command blacklist        |
| `packages/plugins/`        | Plugin registry + hooks                                    |
| `packages/i18n/`           | Translations                                               |
| `packages/sdk/`            | Embedding / HostProvider API                               |
| `packages/shared/`         | Types, constants, `env-loader`, small utils                |
| `packages/test-utils/`     | Test/benchmark helpers                                     |

---

## Quick Start

### Recommended — Install from npm

Prerequisites: **Node.js ≥ 20.18** and npm ≥ 11.

```bash
npm install -g @goli-cli/cli
goli --version
goli wakeup
```

For the default route, run **local Ollama** (`ollama serve`, no key) or
set `OLLAMA_API_KEY` for the Ollama Cloud tier; for Anthropic/Gemini
set the matching key. Config lives in `~/.goli/config.toml` (or env
vars — see [docs/user/reference/env-vars.md](docs/user/reference/env-vars.md)).

### From source — Contributors & development

Prerequisites: **Node.js ≥ 20.18** and npm ≥ 11 (the repo pins
`packageManager: npm@11.13.0`).

```bash
# 1. Clone
git clone https://github.com/Gauravkumar260/Goli-CLI.git
cd goli-cli

# 2. Install + build (Turborepo — packages build in topological order)
npm install
npm run build

# 3. Configure the model backend
cp .env.example .env     # edit keys
```

For the default route, run **local Ollama** (`ollama serve`, no key) or
set `OLLAMA_API_KEY` in `.env` for the Ollama Cloud tier; for
Anthropic/Gemini put the matching key in `.env`.

```bash
# 4. Run
npm run goli -- wakeup            # interactive TUI
npm run goli -- -p 'explain this repo'   # headless, print result
npm run goli -- doctor            # health check
npm run goli -- --version         # print version
```

> `.env` is **not** committed (see `.gitignore`) — secrets stay local.

---

## Command reference

| Command                                        | What you get                                                    |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `goli wakeup [prompt]`                         | Start the agent (TUI, or with a prompt argument, headless chat) |
| `goli -p <text>`                               | Headless: run one prompt, print result to stdout, exit          |
| `goli --local-llms`                            | Router across local Ollama workers + cloud (three-axis)         |
| `goli doctor`                                  | Check config, providers, sandbox, runtime deps                  |
| `goli status`                                  | Show session/status info                                        |
| `goli mcp add/remove/list/scan`                | Manage MCP servers                                              |
| `goli cron [subcommand]`                       | Schedule agent runs (tick/terminator)                           |
| `goli --model <id>`                            | Override the active model for the session                       |
| `goli --sandbox <mode>`                        | `read-only` (default) · `workspace-write` · `full-access`       |
| `goli --god`                                   | Bypass approval gates — **not recommended without reason**      |
| `goli --auto`                                  | Auto-approve tier-2 (risky) actions                             |
| `goli --output-format text\|json\|stream-json` | Headless output shape                                           |
| `goli --resume <id>` / `goli --branch <id>`    | Resume / branch a prior session                                 |

Run `goli --help` for the full flag list. Shell completions
(`apps/cli/completions/`) are available for bash, zsh, and fish.

---

## Development

```bash
npm run dev          # run CLI in dev (no dist needed)
npm run typecheck    # tsc --noEmit (turbo, all packages)
npm run lint         # eslint . (--max-warnings 0)
npm test             # vitest unit + integration (3342 total, 3338 passing)
npm run verify       # build && lint && typecheck && test
```

Other useful gates: `npm run test:e2e`, `test:isolated` (subprocess-per-test),
`test:perf`, `test:memory`, `test:coverage`, plus `npm run bench` for
cold-start metrics. See `CONTRIBUTING.md`.

## Documentation

| Doc                                                  | What it covers              |
| ---------------------------------------------------- | --------------------------- |
| [docs/README.md](docs/README.md)                     | Documentation home          |
| [docs/architecture.md](docs/architecture.md)         | How the pieces fit          |
| [docs/agents.md](docs/agents.md)                     | Agent swarm / orchestration |
| [docs/getting-started.md](docs/getting-started.md)   | 5-minute tutorial           |
| [docs/tui/architecture.md](docs/tui/architecture.md) | TUI components              |
| [docs/cli/themes.md](docs/cli/themes.md)             | Skins + theming             |
| [docs/extensions/mcp.md](docs/extensions/mcp.md)     | MCP integration             |
| [docs/api/README.md](docs/api/README.md)             | API reference               |
| [docs/decisions/](docs/decisions/)                   | 47 ADRs                     |
| [docs/coverage-report.md](docs/coverage-report.md)   | Test coverage               |
| [docs/a11y-report.md](docs/a11y-report.md)           | Accessibility               |
| [apps/studio/README.md](apps/studio/README.md)       | Web console                 |

## Goli Studio (experimental)

A browser companion: starts a server-side agent loop with streaming output,
tool-call cards, and permission prompts. Still a work in progress —
treat it as an extrusion, and the CLI as the well-maintained surface.

```bash
npm run studio:db:generate && npm run studio:db:push
npm run studio:runtime & npm run studio:dev   # http://localhost:3000
```

## Roadmap (honest)

- Solidify the evals harness (`packages/evals`) and SWE-bench-style integration
- Finish SSE/WebSocket MCP transports (currently stdio + HTTP; SSE/WS fall back to HTTP)
- Replace bubblewrap with native Landlock for the Linux sandbox (today `landlock.ts` wraps bwrap)
- Provider streaming improvements, better context-window budgets
- Whatever breaks during my PhD-free weeknights

## Contributing

This is a student side project, so keep expectations low — but small,
kind PRs and thoughtful issue reports are welcome. Baseline for any
change: `npm run build && npm run lint && npm run typecheck && npm test`.

## License

MIT — see [LICENSE](LICENSE). The default backend is open-weight
(`ollama/gpt-oss:120b-cloud`). See [AGENTS.md](AGENTS.md) for the
codebase pattern/gotcha notes and `CODE-MAP.md` for the source map.

## Status Note

Most of the features described above work at least partially, but not all
of them are complete or reliable yet. Some features are ahead of the current
implementation. See the [Roadmap](#roadmap-honest) and the known-gap data in
[`bench/scores.json`](bench/scores.json) for more detail.

I'm actively working through these gaps and rough edges. Expect fixes,
improvements, and honest corrections as the project evolves.
