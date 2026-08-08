# Software Design Document (SDD) — Goli-CLI

> **Standard:** IEEE 1016-2009
> **Status:** v0.3 (Draft for `0.3.0-phase2-studio`)
> **Last updated:** 2026-07-25
> **Companion to:** [PRD](../requirements/prd.md) · [SRS](../requirements/srs.md) · [C4 Diagrams](diagrams/c4-diagrams.md)

## 1. Introduction

### 1.1 Purpose

This SDD describes the software design of Goli-CLI. It is the
authoritative reference for how the system is structured, how its
components interact, and how it meets the requirements in the SRS. Every
design decision referenced here is captured in an ADR under
`docs/decisions/`.

### 1.2 Scope

The SDD covers the four production packages (`core`, `cli`, `evals`,
`vscode-ext`) and the experimental `studio` package. It does **not**
cover third-party libraries, deployment infrastructure (covered in
`docs/ops/`), or test design (covered in `docs/qa/`).

### 1.3 Definitions

See SRS §1.3.

## 2. System overview

Goli-CLI is an npm workspaces monorepo with five packages:

```
goli-cli/
├── packages/
│   ├── core/         # @goli-cli/core    — agent IP, no UI
│   ├── cli/          # @goli-cli/cli     — Ink TUI
│   ├── evals/        # @goli-cli/evals   — eval harnesses
│   ├── vscode-ext/   # @goli-cli/vscode-ext (experimental)
│   └── studio/       # @goli-cli/studio  — Next.js 16 web console (experimental)
├── tests/            # cross-package integration + e2e tests
├── docs/             # this directory
├── scripts/          # build / bench / SBOM scripts
├── infra/            # k8s / docker-compose for self-hosting
├── config/           # default TOML config
├── services/ml-pipeline/        # GRPO training + eval scripts
└── bin/              # the `goli` executable
```

The dependency direction is strictly:

```
cli → core
studio → (independent re-implementation; shares types only)
evals → core
vscode-ext → core
```

`core` never imports from `cli`, `studio`, `evals`, or `vscode-ext`. This
is enforced by an ESLint `no-restricted-imports` rule.

## 3. Package: `@goli-cli/core`

### 3.1 Module map

| Module         | Path                 | Purpose                                                                                                          | Key ADRs                                                   |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Agent loop     | `src/agent/`         | ReAct loop, retry, loop detection, stall detection, JSON repair, prompt caching, reflexion, planner, stop engine | 0001, 0007, 0009, 0010, 0023, 0024, 0025, 0030, 0037, 0042 |
| Provider layer | `src/providers/`     | `ModelProvider` interface + Anthropic, OpenAI, Gemini, Ollama, Mock                                              | 0007, 0034                                                 |
| Tools          | `src/tools/`         | Tool registry, built-in tools, MCP client, hooks, parallel execution, dynamic tool manager                       | 0014, 0015, 0018, 0019, 0021, 0039, 0042, 0043, 0044, 0046 |
| Sandbox        | `src/sandbox/`       | Path validation, executor, network filter, Landlock / Seatbelt / cgroups / audit log                             | 0001, 0016                                                 |
| Approval       | `src/approval/`      | Permission engine, blast-radius calculator, enhanced approval                                                    | 0015                                                       |
| Context        | `src/context/`       | Tree-sitter indexer, symbol graph, hybrid retriever, project map, compaction engine, subagent isolation          | 0021, 0022, 0023, 0024, 0036, 0046                         |
| Memory         | `src/memory/`        | Ephemeral / persistent / external tiers, trajectory curator, SICA, training pipeline                             | 0029, 0027, 0030, 0033                                     |
| Eval           | `src/evals/`         | SWE-bench harness, semantic-error-rate, redteam                                                                  | 0032, 0033                                                 |
| Observability  | `src/observability/` | OTel tracer, Langfuse client, alerts manager                                                                     | 0032                                                       |
| Orchestration  | `src/orchestration/` | Worktree isolation, task splitter, cloud E2B, swarm pipeline, shared-state blackboard                            | 0035, 0036, 0039                                           |
| Config         | `src/config/`        | TOML loader, schema, mode prompts, integrity                                                                     | 0006                                                       |
| API            | `src/api/`           | HTTP server for headless mode                                                                                    | 0043                                                       |
| Gateway        | `src/gateway/`       | Public API gateway                                                                                               | —                                                          |
| Plugins        | `src/plugins/`       | Plugin registry                                                                                                  | —                                                          |
| i18n           | `src/i18n/`          | Locale catalogs (en, de, es, ja, zh-CN)                                                                          | —                                                          |
| Utils          | `src/utils/`         | Logger, JSON utils, errors, constants                                                                            | —                                                          |

### 3.2 Agent loop design

The agent loop is the heart of `core`. It is **single-threaded** (ADR 0009)
and uses a **ReAct** pattern with the following per-turn structure:

```
┌──────────────────────────────────────────────────────────────┐
│ while (!stop):                                                │
│   1. Build prompt (system + frozen snapshot + history + user) │
│   2. Call provider with stream=true                           │
│   3. For each token: emit 'agent:token' to subscribers       │
│   4. Parse tool calls from the stream                        │
│   5. For each tool call (in parallel if multiple):            │
│      a. Fire BeforeTool hooks (may block / modify input)     │
│      b. Resolve permission (ask / yolo / plan)               │
│      c. If permission denied → return error to model         │
│      d. Execute tool in sandbox                              │
│      e. Truncate result to budget                            │
│      f. Fire AfterTool hooks (may modify output)             │
│      g. Emit 'agent:tool_end' to subscribers                 │
│   6. Loop detector: if same call ≥5×, inject loop-break msg  │
│   7. Stall detector: if no token for 30s, emit stall event   │
│   8. If model emitted a final message (no tool calls) → stop │
│   9. Compaction: if context ≥70% → compact                  │
│  10. Reflexion: if error → inject reflexion note             │
└──────────────────────────────────────────────────────────────┘
```

The loop is implemented in `src/agent/loop.ts` as an async generator
that yields `AgentEvent` objects. The TUI and the headless runner both
consume the generator; they never call the loop directly.

### 3.3 Provider abstraction

All providers implement the `ModelProvider` interface:

```typescript
interface ModelProvider {
  readonly id: string; // 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'mock'
  readonly models: readonly string[]; // supported model strings
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  countTokens(text: string): number; // for budget tracking
}
```

The `ProviderRouter` (`src/providers/router.ts`) selects a provider
based on the model string prefix (`anthropic/`, `openai/`, etc.). The
local-LLMs router (`src/agent/local-llms-router.ts`) is a higher-order
provider that holds 5 `OllamaProvider` instances and routes based on
sensitivity / complexity / availability.

### 3.4 Tool registry

Tools implement the `Tool` interface:

```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema; // Zod → JSON Schema
  readonly outputSchema: JSONSchema;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
  readonly capabilities?: ToolCapabilities; // for the footprint ladder
}
```

The registry (`src/tools/registry.ts`) supports:

- **Static registration** — built-in tools register at startup.
- **Self-registration** — MCP servers and plugins register at runtime
  (ADR: 0044).
- **Dynamic tool manager** — tools can be enabled/disabled per turn
  based on the footprint ladder (ADR: 0025).

### 3.5 Sandbox

The sandbox is **kernel-enforced** (ADR: 0016):

| OS           | Mechanism                      | File                      |
| ------------ | ------------------------------ | ------------------------- |
| Linux ≥ 5.13 | Landlock                       | `src/sandbox/landlock.ts` |
| macOS        | Seatbelt (sandbox-exec)        | `src/sandbox/seatbelt.ts` |
| Windows      | Job Object + restricted token  | (planned)                 |
| All          | cgroups v2 (CPU/memory limits) | `src/sandbox/cgroups.ts`  |

The sandbox restricts:

- Filesystem writes to the workspace root (TOCTOU-safe, ADR: 0001).
- Network egress (default deny, allowlist for `web_search` / `web_fetch`).
- Process tree (no `fork bombs`, no `exec` outside allowlist).

### 3.6 Memory

Memory has three tiers:

| Tier       | Storage                    | Lifetime    | Use                 |
| ---------- | -------------------------- | ----------- | ------------------- |
| Ephemeral  | In-process Map             | One session | Working memory      |
| Persistent | JSONL on disk              | Forever     | Session transcripts |
| External   | Vector plugin (sqlite-vec) | Forever     | Semantic search     |

The SICA loop (`src/memory/sica/`) runs alongside the agent and:

- **Overseer** — a separate LLM call critiques the agent's last turn.
- **Immutable registry** — any behavior flagged as unsafe is permanently
  blocked (`src/memory/sica/immutable-registry.ts`).
- **Overfit detector** — prevents the agent from over-fitting to the
  overseer's critiques.
- **Rate limiter** — prevents the overseer from thrashing.

## 4. Package: `@goli-cli/cli`

### 4.1 Module map

| Module    | Path               | Purpose                                                                                                                                             |
| --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| TUI       | `src/tui/`         | Ink + React 19 terminal UI                                                                                                                          |
| Commands  | `src/commands/`    | Commander subcommands (`wakeup`, `status`, `usage`, `init`, `mcp-config`, `audit`, `headless-output`, `doctor`, `mcp`, `cron`, `commit`, `profile`) |
| Services  | `src/services/`    | `CliAgentLoop`, `MockAgentLoop`, `IAgentLoop`                                                                                                       |
| Constants | `src/constants.ts` | CLI-wide constants                                                                                                                                  |
| Index     | `src/index.ts`     | Entry point; Commander program                                                                                                                      |

### 4.2 TUI architecture

See [`docs/tui/architecture.md`](../tui/architecture.md) for the full
TUI component tree and state model. The 10-second summary:

- `App.tsx` is the root; it owns the `AppStateStore` (Zustand).
- The store is mutated by the `useAgentLoop` hook, which subscribes to
  the agent loop's async generator.
- Components are pure (presentational) or container (own state). No
  component reads the store directly except through hooks.
- The `TurnStateMachine` (`src/tui/lib/TurnStateMachine.ts`) is a
  state machine for the per-turn UI (idle → streaming → tool-running →
  permission-pending → done).

### 4.3 Slash commands

The slash-command system (`src/tui/lib/CommandRegistry.ts`) is a unified
registry fed by four loaders:

- `BuiltinCommandLoader` — built-in commands (`/help`, `/mode`, `/reset`).
- `SkillCommandLoader` — commands defined by skills.
- `McpPromptLoader` — commands defined by MCP prompts.
- `FileCommandLoader` — commands in `~/.goli/commands/*.md`.

The same registry is used by the TUI and the headless runner, so a
custom command works identically in both surfaces.

## 5. Package: `@goli-cli/evals`

### 5.1 Module map

| Module          | Path                              | Purpose                               |
| --------------- | --------------------------------- | ------------------------------------- |
| SWE-bench       | `src/swebench/harness.ts`         | Run the agent against SWE-bench tasks |
| Semantic check  | `src/semantic-check/evaluator.ts` | LLM-graded pass/fail                  |
| Redteam         | `src/redteam/promptfoo.ts`        | Prompt injection tests                |
| Regression gate | `src/regression/gate.ts`          | Block releases on regressions         |
| Types           | `src/types.ts`                    | Eval types                            |
| Index           | `src/index.ts`                    | Public API                            |

### 5.2 Eval workflow

```
1. Pick a task (SWE-bench / redteam / regression).
2. Spin up a clean workspace (git worktree).
3. Run the agent with the task prompt.
4. Capture the agent's tool calls + final answer.
5. Grade:
   - SWE-bench: run the test suite; pass/fail.
   - Semantic: LLM-graded pass/fail with rubric.
   - Redteam: did the agent execute the injected command?
6. Write a JSON report to evals/output/<suite>/<timestamp>.json.
7. Compare against the baseline; fail CI on regression.
```

## 6. Package: `@goli-cli/studio` (experimental)

The studio is a **separate implementation** of the agent contract, not a
thin wrapper around `@goli-cli/core`. See
[`apps/studio/README.md`](../../apps/studio/README.md) for the full design.

The 30-second version:

- Next.js 16 App Router on :3000.
- socket.io mini-service on :3003 (`mini-services/agent-runtime/`).
- Caddy reverse proxy bridges :81 → :3000 → :3003 via `?XTransformPort`.
- Prisma + SQLite for sessions.
- `z-ai-web-dev-sdk` for LLM calls (server-side only).
- React 19 + Tailwind 4 + shadcn/ui (New York) for the UI.

The studio shares **types** with the CLI (via `src/lib/types/`) but not
**code**. This keeps the CLI bundle small (no React DOM, no Prisma) and
lets the studio use the full modern web stack.

## 7. Cross-cutting concerns

### 7.1 Configuration

Config is TOML (ADR: 0006), loaded by `src/config/loader.ts`. Schema is
Zod. Env vars override config: `GOLI_<SECTION>_<KEY>` (e.g.
`GOLI_LOCAL_LLMS_COMPLEXITY_THRESHOLD_CLOUD=8`).

### 7.2 Observability

OTel traces are emitted for every agent run, tool call, and provider
call (`src/observability/tracing/otel.ts`). Traces are exported to
Langfuse (`src/observability/langfuse/client.ts`) for visualization.

### 7.3 Internationalization

All user-facing strings go through `t()` from `src/i18n/index.ts`.
Catalogs live in `src/i18n/catalogs/<locale>.ts`. Hardcoded strings are
a lint error.

### 7.4 Error handling

All errors extend `BaseError` (`src/utils/errors.ts`) and have a stable
`code` field. The error classifier (`src/agent/error-classifier.ts`)
maps provider errors to a small set of internal error types that the
retry loop understands.

### 7.5 Logging

`src/utils/logger.ts` is a structured logger (pino under the hood).
Levels: `trace`, `debug`, `info`, `warn`, `error`. The CLI's `--debug`
flag enables `trace` and the Node inspector.

## 8. Design decisions (ADR summary)

See [Decision Log](decision-log.md) for the flat index. The 10 most
load-bearing decisions:

1. **ADR 0001** — Sandbox is the trust boundary (not the agent).
2. **ADR 0002** — TypeScript implementation (not Rust / Go).
3. **ADR 0006** — TOML config (not JSON / YAML).
4. **ADR 0009** — Single-threaded loop (no worker threads for the agent).
5. **ADR 0015** — Allowlist-first bash (not prompt-based safety).
6. **ADR 0016** — Kernel-enforced sandbox (Landlock / Seatbelt).
7. **ADR 0023** — Compaction at 70% of context window.
8. **ADR 0025** — Hard character budgets (the footprint ladder).
9. **ADR 0030** — LLM safety overseer (SICA).
10. **ADR 0037** — Diff-first editing (review before apply).

## 9. Revision history

| Date       | Version | Author          | Change                                                             |
| ---------- | ------- | --------------- | ------------------------------------------------------------------ |
| 2026-07-07 | v0.1    | Lead Maintainer | Initial SDD for 0.1.0                                              |
| 2026-07-13 | v0.2    | Lead Maintainer | Updated for 0.2.0 (Phase 2); added §3.6 SICA, §3.5 sandbox details |
| 2026-07-25 | v0.3    | Lead Maintainer | Added §6 Goli Studio; refreshed ADR list (now 47 ADRs)             |
