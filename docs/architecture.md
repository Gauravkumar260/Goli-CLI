# Goli-CLI Architecture

> High-level architecture overview. For detailed API, see the [API Reference](api/_generated/index.html). For the 11-agent pipeline, see [Agents](agents.md).

## Module Map

Goli-CLI is an npm workspaces monorepo with 4 packages:

```
goli-cli/
├── packages/
│   ├── core/           @goli/core — the "Brain"
│   │   ├── agent/        GLM client, agent loop, system prompt assembler
│   │   ├── api/          HTTP API server (for IDE integrations)
│   │   ├── approval/     diff-first approval flow (H14)
│   │   ├── config/       TOML config loader
│   │   ├── context/      hybrid retriever (structural + lexical + semantic)
│   │   ├── evals/        SWE-bench evaluation harness
│   │   ├── memory/       JSONL session store, SICA immutable registry, skills
│   │   ├── observability/ audit log, error classifier
│   │   ├── orchestration/ 11-agent swarm pipeline (Scout → Documenter)
│   │   ├── plugins/      plugin registry + lifecycle
│   │   ├── sandbox/      cgroups v2, Landlock, bubblewrap, seatbelt
│   │   ├── tools/        21 registered tools (core + gap + spec + LSP + subagent)
│   │   └── utils/        constants, logger, errors
│   ├── cli/            @goli/cli — the TUI + binary
│   │   ├── commands/     wakeup, doctor, status, audit, usage, commit, init, mcp
│   │   ├── services/     CliAgentLoop, MockAgentLoop, IAgentLoop
│   │   ├── tui/          14 Ink components + theme + hooks + lib
│   │   ├── constants.ts  CLI-local constants (lazy-loaded for fast cold-start)
│   │   └── index.ts      Commander entry point (lazy-loaded commands)
│   ├── evals/          @goli/evals — SWE-bench-style evaluation harness
│   └── vscode-ext/     standalone VS Code extension (NOT in workspaces — see ADR 0010)
├── tests/              71 test files, 1117 tests (root-level vitest)
├── scripts/            bench, a11y-audit, gen-completions, gen-10k-repo, tti-bench, clean-room-verify
├── completions/        bash/zsh/fish shell completions
├── docs/               decisions (ADRs), extensions, phases, api/_generated/
├── examples/           mcp-hello-world/
├── bench/              baseline.json + fixtures/repo-10k/
└── config/             default.toml
```

## The 11-Agent Swarm Pipeline

Goli-CLI's core differentiator is an 11-agent pipeline that decomposes complex tasks into specialized roles. Each agent has a single responsibility and hands off to the next:

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Scout         — explores the repo, identifies relevant files │
│  2. Researcher    — reads docs, web search, gathers context      │
│  3. Architect     — designs the solution approach                │
│  4. Planner       — breaks the approach into atomic steps        │
│  5. Implementer   — writes the code changes                      │
│  6. Debugger      — runs tests, fixes failures                   │
│  7. QA/Tester     — writes new tests, verifies edge cases        │
│  8. Security Auditor — checks for vulns, secrets, unsafe patterns│
│  9. Reviewer      — reviews the diff for quality                 │
│ 10. Orchestrator  — coordinates handoffs, manages budget         │
│ 11. Documenter    — updates README, CHANGELOG, inline docs       │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Final Output (code + tests + docs)
```

The pipeline is implemented in `packages/core/src/orchestration/swarm-pipeline.ts`. Each agent is a role-specialized instance of the same `AgentLoop` class, with a different system prompt and tool subset.

## The Agent Loop (ReAct Master Loop)

At the heart of each agent is a single-threaded ReAct (Reason + Act) loop:

```
User/Orchestrator Prompt
    │
    ▼
┌─── INIT ────────────────────────────────────────────┐
│ Load config, create tool registry, init budget      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─── LOOP (max N iterations or budget) ───────────────┐
│ 1. PLAN: assemble system prompt + context           │
│ 2. CALL: GLM-5.2 with tools                         │
│ 3. OBSERVE: execute tool calls (tier-gated)         │
│ 4. REFLECT: check budget, stall, guardrails         │
│ 5. COMPACT: if context > 70%, compress              │
│ 6. REPEAT or DONE                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
Result (content + tokens + cost + todos)
```

Key components:
- **`AgentLoop`** (`packages/core/src/agent/loop.ts`) — the loop itself
- **`GLMClient`** (`packages/core/src/agent/glm-client.ts`) — OpenAI-compatible API client for GLM-5.2
- **`SystemPromptAssembler`** — assembles role-specific prompts from fragments
- **`Planner`** — maintains the TODO list
- **`BudgetTracker`** — enforces token + cost limits
- **`StallDetector`** — detects no-progress loops
- **`ToolGuardrailController`** — detects exact-failure, same-tool-failure loops
- **`AdvancedCompressor`** — summarizes old context when > 70% full

## Safety Gates

Every tool call passes through tier-gated safety checks:

| Tier | Description | Examples | Approval |
|---|---|---|---|
| T0 | Read-only | `read_file`, `list_directory`, `grep` | Auto-approved |
| T1 | Workspace write | `write_file`, `edit_file`, `bash` (sandboxed) | Auto in `--auto`, else prompt |
| T2 | Risky | `bash` (network), `web_fetch`, `spawn_subagent` | Always prompt (unless `--god`) |
| T3 | Destructive | `bash` (`rm -rf`, `git push --force`) | Always prompt, even in `--god` |
| BLK | Blocked | `bash` (`rm -rf /`), secrets exfiltration | Never allowed |

The sandbox layer (`packages/core/src/sandbox/`) provides OS-level isolation:
- **cgroups v2** — memory + CPU limits (Linux)
- **Landlock** — filesystem path restrictions (Linux 5.13+)
- **bubblewrap** — namespace isolation (Linux)
- **seatbelt** — sandbox profiles (macOS)

## Tool Registry (21 tools)

| Category | Tools |
|---|---|
| Core (6) | `read_file`, `write_file`, `edit_file`, `list_directory`, `grep`, `bash` |
| Gap (7) | `web_search`, `web_fetch`, `todo_write`, `bash_output`, `kill_shell`, `ask_user`, `notebook_edit` |
| Spec (3) | `spec_write`, `spec_review`, `spec_update` |
| Subagent (1) | `spawn_subagent` |
| LSP (4) | `lsp_hover`, `lsp_goto_definition`, `lsp_references`, `lsp_diagnostics` |

The registry is created by `createDefaultToolRegistry()` in `packages/core/src/tools/index.ts`. MCP servers add tools at runtime via `MCPClientManager.connectAll()`.

## Configuration

Goli-CLI reads from `config/default.toml` (project) and `~/.goli-cli/config.toml` (user). Key sections:

```toml
[model]
modelId = "glm-5.2"
baseUrl = "http://localhost:8000/v1"
defaultEffort = "high"
contextWindowTokens = 1_000_000

[sandbox]
mode = "workspace-write"  # read-only | workspace-write | danger-full-access

[agent]
maxIterations = 50
budgetTokens = 2_000_000
budgetCostUsd = 5.0
```

See `config/default.toml` for the full schema.

## Multi-Provider Support

Goli-CLI supports multiple LLM providers via an integrated providers module at `packages/core/src/providers/`. The provider is selected via the `GOLI_DEFAULT_MODEL` env var (format: `provider/model`, e.g. `ollama/gpt-oss:120b`).

Supported providers:
- **Ollama** (default) — `ollama/<model>`, uses `OLLAMA_BASE_URL` + `OLLAMA_API_KEY`
- **OpenAI** — `openai/<model>`, uses `OPENAI_API_KEY`
- **Anthropic** — `anthropic/<model>`, uses `ANTHROPIC_API_KEY`
- **Gemini** — `gemini/<model>`, uses `GEMINI_API_KEY` (requires `@google/generative-ai` package)

The `ProviderBackedGLMClient` adapter (in `packages/core/src/agent/provider-adapter.ts`) wraps any provider as a `GLMClient`, so the existing `AgentLoop` works without modification. When `GOLI_DEFAULT_MODEL` starts with `ollama/`, `openai/`, or `anthropic/`, the adapter is used instead of the GLM client.

## See Also

- [Getting Started](getting-started.md) — 5-minute tutorial
- [Agents](agents.md) — detailed per-agent reference
- [API Reference](api/_generated/index.html) — typedoc HTML
- [MCP Extensions](extensions/mcp.md) — how to add custom tools
- [ADRs](decisions/) — architectural decision records
