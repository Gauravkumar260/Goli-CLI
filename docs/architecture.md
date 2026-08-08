# Goli-CLI Architecture

> High-level architecture overview. For detailed API, see the [API Reference](api/_generated/index.html). For the 11-agent pipeline, see [Agents](agents.md).

## Module Map

Goli-CLI is an npm workspaces monorepo with 3 apps + 16 `@goli-cli/*` packages:

```
goli-cli/
├── apps/
│   ├── cli/          @goli-cli/cli — the TUI + binary
│   │   ├── commands/   wakeup, doctor, status, audit, usage, commit, init, mcp, cron, profile, hooks
│   │   ├── services/   CliAgentLoop, MockAgentLoop, IAgentLoop
│   │   ├── tui/        25+ Ink components + theme engine (25 skins) + 11 hooks + 25+ lib modules + state store
│   │   ├── completions/ bash/zsh/fish shell completions
│   │   ├── constants.ts CLI-local constants (lazy-loaded for fast cold-start)
│   │   └── index.ts     entry point (env-loader + lazy-loaded commands)
│   ├── studio/       nextjs_tailwind_shadcn_ts — web console ("Goli Studio")
│   └── vscode-ext/   goli-vscode — standalone VS Code extension (in workspaces since ADR-0047)
├── packages/
│   ├── agent-core/     @goli-cli/agent-core — the "Brain": ReAct loop, prompt builder, toolset snapshot, provider adapter, budget, retry, reflexion, planner, effort router, stop engine, stall/loop detection
│   ├── llm-providers/  @goli-cli/llm-providers — Ollama (default), Anthropic, Gemini, Mock (+ OpenAI, legally blocked)
│   ├── tool-system/    @goli-cli/tool-system — 21 registered tools + hooks + MCP + footprint ladder
│   ├── context-engine/ @goli-cli/context-engine — hybrid retriever + tree-sitter indexer (regex fallback) + compaction
│   ├── memory-engine/  @goli-cli/memory-engine — SQLite FTS5 session store, SICA registry, skills, trajectory
│   ├── config/         @goli-cli/config — TOML loader + Zod schema + mode prompts + integrity manager
│   ├── approval/       @goli-cli/approval — diff-first approval + blast radius + enhanced approval
│   ├── observability/  @goli-cli/observability — audit log, OTel tracing, Langfuse, alerts, error classifier
│   ├── orchestration/  @goli-cli/orchestration — 11-agent swarm pipeline + worktree + E2B + classifier + blackboard
│   ├── plugins/        @goli-cli/plugins — plugin registry + lifecycle + hooks
│   ├── i18n/           @goli-cli/i18n — locale catalogs
│   ├── sandbox/        @goli-cli/sandbox — seatbelt (macOS), landlock/bubblewrap (Linux), cgroups, network, path-validation, audit-log
│   ├── sdk/            @goli-cli/sdk — MCP SDK server + gateway
│   ├── evals/          @goli-cli/evals — SWE-bench harness, semantic evaluator, regression gate, redteam
│   ├── shared/         @goli-cli/shared — constants, logger, errors, json-utils, env-loader
│   └── test-utils/     @goli-cli/test-utils — perf harness (source-only, no build)
├── tests/              root-level vitest (integration + e2e) — 3,376 tests (unit tests are colocated)
├── perf-tests/         perf harness + baselines (cold-start, module-load)
├── memory-tests/       heap baseline
├── scripts/            bench, a11y-audit, gen-completions, gen-10k-repo, tti-bench, run-isolated-tests
├── services/ml-pipeline/          GRPO + LoRA training pipeline (Module 5 ML side)
├── docs/               decisions (47 ADRs), extensions, phases, api, tui, cli
├── examples/           mcp-hello-world/
├── infra/              docker-compose + k8s manifests + LiteLLM router config
├── bench/              baseline.json + fixtures/repo-10k/
├── legal/              PRIVACY_POLICY.md, TERMS_OF_SERVICE.md, ai-bom.spdx.json
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

The pipeline is implemented in `packages/orchestration/src/swarm-pipeline.ts`. Each agent is a role-specialized instance of the same `AgentLoop` class, with a different system prompt and tool subset.

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
│ 1. PLAN: assemble system prompt + context (3-tier, prefix-cache-stable)│
│ 2. CALL: default model (Ollama, `gpt-oss:120b-cloud`) with tools       │
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

- **`AgentLoop`** (`packages/agent-core/src/loop.ts`) — the loop itself
- **`ProviderBackedModelClient`** (`packages/agent-core/src/provider-adapter.ts`) — wraps any `ModelProvider` (Ollama default, OpenAI, Anthropic, Gemini, Mock) as a uniform model client
- **`SystemPromptAssembler`** (`packages/agent-core/src/system-prompt.ts`) — assembles role-specific prompts from ordered, prefix-cache-friendly fragments (three-tier prompt structure; see [single-threaded loop](user/explanation/single-threaded-loop.md))
- **`Planner`** (`packages/agent-core/src/planner.ts`) — maintains the TODO list (one `in_progress` at a time)
- **`BudgetTracker`** (`packages/agent-core/src/budget.ts`) — enforces token + cost + iteration + wall-clock limits
- **`StopEngine`** (`packages/agent-core/src/stop-engine.ts`) — 4-condition stop: natural completion / budget / stall / parse failures
- **`StallDetector`** + **`LoopDetector`** + **`ToolGuardrails`** — three layers of loop detection (prevents the $47K LangChain incident)
- **`AdvancedCompressor`** (`packages/agent-core/src/advanced-compression.ts`) — summarizes old context when > 50% full (in-loop trigger); safety-net at 85%
- **`ReflexionEngine`** (`packages/agent-core/src/reflexion.ts`) — generates natural-language reflection on structural failure (Shinn et al., 2023)
- **`EffortRoutingClient`** (`packages/agent-core/src/effort-router.ts`) — auto-routes reasoning effort (high for tools, max for planner/architect, max for final answer)
- **`CredentialPool`** (`packages/agent-core/src/credential-pool.ts`) — round-robin through OK credentials; rotates on rate limit / billing
- **`ProvenanceTracker`** (`packages/agent-core/src/provenance.ts`) — tags context blocks with TrustLevel (prompt-injection defense)

## Safety Gates

Every tool call passes through tier-gated safety checks:

| Tier | Description     | Examples                                        | Approval                       |
| ---- | --------------- | ----------------------------------------------- | ------------------------------ |
| T0   | Read-only       | `read_file`, `list_directory`, `grep`           | Auto-approved                  |
| T1   | Workspace write | `write_file`, `edit_file`, `bash` (sandboxed)   | Auto in `--auto`, else prompt  |
| T2   | Risky           | `bash` (network), `web_fetch`, `spawn_subagent` | Always prompt (unless `--god`) |
| T3   | Destructive     | `bash` (`rm -rf`, `git push --force`)           | Always prompt, even in `--god` |
| BLK  | Blocked         | `bash` (`rm -rf /`), secrets exfiltration       | Never allowed                  |

The sandbox layer (`packages/sandbox/src/`) provides OS-level isolation:

- **cgroups v2** — memory + CPU limits (Linux)
- **bubblewrap (`bwrap`)** — namespace isolation and filesystem path restrictions (Linux). The file `landlock.ts` is misnamed — it wraps bubblewrap, not native Landlock syscalls. Native Landlock is future work.
- **seatbelt / sandbox-exec** — namespace isolation + sandbox profiles (macOS)

## Tool Registry (21 tools)

| Category     | Tools                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Core (6)     | `read_file`, `write_file`, `edit_file`, `list_directory`, `grep`, `bash`                          |
| Gap (7)      | `web_search`, `web_fetch`, `todo_write`, `bash_output`, `kill_shell`, `ask_user`, `notebook_edit` |
| Spec (3)     | `spec_write`, `spec_review`, `spec_update`                                                        |
| Subagent (1) | `spawn_subagent`                                                                                  |
| LSP (4)      | `lsp_hover`, `lsp_goto_definition`, `lsp_references`, `lsp_diagnostics`                           |

The registry is created by `createDefaultToolRegistry()` in `packages/tool-system/src/index.ts`. MCP servers add tools at runtime via `MCPClientManager.connectAll()`.

## Configuration

Goli-CLI reads from `config/default.toml` (project) and `~/.goli-cli/config.toml` (user). Key sections:

```toml
[model]
# Default model — overridden by GOLI_DEFAULT_MODEL env var (e.g. ollama/gpt-oss:120b-cloud)
modelId = "gpt-oss:120b-cloud"
baseUrl = "https://ollama.com"
apiKey = ""
defaultEffort = "high"        # routine tasks
complexEffort = "max"         # refactor / debug / architecture
complexTriggers = ["refactor", "design", "architecture", "debug", "migrate", "rewrite"]
maxContextTokens = 1_000_000
requestTimeoutMs = 120_000
streaming = true

[budget]
maxTokens = 800_000           # 80% of 1M, leaves compaction room
maxCostUsd = 5.0
maxIterations = 50
maxWallclockSeconds = 1800
costPerMillionInputTokens = 2.5
costPerMillionOutputTokens = 10.0

[retry]
maxRetries = 3
initialBackoffMs = 1000
backoffMultiplier = 2.0
maxBackoffMs = 30_000
jitterFactor = 0.5

[stall]
identicalCallThreshold = 3   # 3 identical tool calls = stop
windowSize = 5
maxParseFailures = 3

[sandbox]
mode = "workspace-write"      # read-only | workspace-write | danger-full-access
approvalPolicy = "on-request" # on-request | on-failure | never
networkAllowlist = ["github.com:443", "pypi.org:443", "files.pythonhosted.org:443", "registry.npmjs.org:443", "crates.io:443"]
memoryMaxMb = 4096
cpuQuotaPercent = 200
pidMax = 512
diskMaxMb = 10_240
wallclockTimeoutS = 1800

[logging]
level = "info"                # trace | debug | info | warn | error | silent
format = "pretty"             # pretty (TTY) | json (pipelines)
```

See `config/default.toml` for the full schema. Zod schemas in
`packages/config/src/schema.ts` validate every load; failure is fatal.

## Multi-Provider Support

Goli-CLI supports multiple LLM providers via an integrated providers module at `packages/llm-providers/src/`. The provider is selected via the `GOLI_DEFAULT_MODEL` env var (format: `provider/model`, e.g. `ollama/gpt-oss:120b-cloud`).

Supported providers:

- **Ollama** (default) — `ollama/<model>`, uses `OLLAMA_BASE_URL` (default `http://localhost:11434`) + `OLLAMA_API_KEY`. Default model: `gpt-oss:120b-cloud` (open-weight).
- **Anthropic** — `anthropic/<model>`, requires `ANTHROPIC_API_KEY`. Default model: `claude-3-5-sonnet-20241022`. Only provider with `supportsCaching() === true`.
- **Gemini** — `gemini/<model>`, requires `GEMINI_API_KEY`. Default model: `gemini-2.0-flash`.
- **Mock** — `mock/<model>`, deterministic. Used by `--demo` mode and the test suite.
- **OpenAI** — `openai/<model>`, uses `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL` for vLLM / LiteLLM). Note: the **async router** (`createProvider`) legally blocks the `openai/` prefix (HIGH-71/MEDIUM-62, see `packages/llm-providers/src/router.ts`), while the **sync adapter** used by `AgentLoop` (see `packages/agent-core/src/provider-adapter.ts`) still constructs `OpenAIProvider` directly — behavior depends on the entry point.

The `ProviderBackedModelClient` adapter (`packages/agent-core/src/provider-adapter.ts`) wraps any provider as a uniform model client, so the existing `AgentLoop` works without modification. The factory `createProviderBackedClientSync` / `createProviderBackedClient` selects the provider via `GOLI_DEFAULT_MODEL`. A `.env` file with the Ollama Cloud config is shipped in the repo root — no external `dotenv` dependency is required (the loader reads `.env` directly).

## See Also

- [Getting Started](getting-started.md) — 5-minute tutorial
- [Agents](agents.md) — detailed per-agent reference
- [TUI Architecture](tui/architecture.md) — component tree + state model
- [Theme Catalog](cli/themes.md) — 25 built-in themes + user YAML skins
- [MCP Extensions](extensions/mcp.md) — how to add custom tools
- [ADRs](decisions/) — 47 architectural decision records
- [Coverage Report](coverage-report.md) — test coverage + gap analysis
