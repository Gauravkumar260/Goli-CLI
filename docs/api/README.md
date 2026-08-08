# Goli-CLI API Reference

> Entry point for API documentation. For auto-generated TypeDoc output,
> run `npm run docs:gen` (writes to `docs/api/_generated/`).

## Packages

Goli-CLI is an npm workspaces monorepo with 3 apps + 16 `@goli-cli/*` packages:

| Package                | Path                    | Description                                                                              |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `@goli-cli/agent-core` | `packages/agent-core/`  | The "Brain": agent loop, prompt builder, toolset snapshot, provider adapter, planner, budget, retry, reflexion, effort router, stop/stall/loop detection |
| `@goli-cli/shared`     | `packages/shared/`      | Constants, logger, errors, json-utils, env-loader                                        |
| `@goli-cli/config`     | `packages/config/`      | TOML loader, Zod schema, mode prompts, policy-integrity manager                          |
| `@goli-cli/llm-providers` | `packages/llm-providers/` | Ollama (default), Anthropic, Gemini, Mock (+ OpenAI, legally blocked in the async router) |
| `@goli-cli/tool-system`| `packages/tool-system/` | 21 registered tools, tool registry, hooks, MCP client, footprint ladder                  |
| `@goli-cli/sandbox`    | `packages/sandbox/`     | seatbelt (macOS), landlock/bubblewrap (Linux), cgroups, network egress, path validation, audit log |
| `@goli-cli/context-engine` | `packages/context-engine/` | Hybrid retriever, tree-sitter indexer (regex fallback), symbol graph, compaction engine |
| `@goli-cli/memory-engine` | `packages/memory-engine/` | SQLite FTS5 session store, SICA registry, skills, trajectory, training data, persistent memory |
| `@goli-cli/orchestration` | `packages/orchestration/` | 11-agent swarm pipeline, task splitter, worktree isolation, blackboard, E2B sandbox, subagent isolator |
| `@goli-cli/evals`      | `packages/evals/`       | SWE-bench harness, semantic evaluator, regression gate, promptfoo red-team config        |
| `@goli-cli/approval`   | `packages/approval/`    | Diff-first approval engine, blast radius, enhanced approval                              |
| `@goli-cli/observability` | `packages/observability/` | OTel tracing, Langfuse client, alerts manager                                          |
| `@goli-cli/plugins`    | `packages/plugins/`     | Plugin registry + lifecycle + hooks                                                      |
| `@goli-cli/i18n`       | `packages/i18n/`        | 5 locales: en, es, zh-CN, ja, de                                                         |
| `@goli-cli/sdk`        | `packages/sdk/`         | MCP SDK server + gateway (ApiServer, HostProvider)                                       |
| `@goli-cli/test-utils` | `packages/test-utils/`  | Perf-test harness (source-only, no build)                                                |
| `@goli-cli/cli`        | `apps/cli/`             | User-facing TUI (Ink/React), command parsing, binary distribution                        |
| `nextjs_tailwind_shadcn_ts` | `apps/studio/`     | Web console ("Goli Studio")                                                             |
| `goli-vscode`          | `apps/vscode-ext/`     | Standalone VS Code extension (in npm workspaces since ADR-0047)                          |

## API surface by package

Each `@goli-cli/*` package exposes its public API from its `src/index.ts`
(`@goli-cli/cli` from `apps/cli/src/index.ts`).

### `@goli-cli/shared` — utils & types

```typescript
import {
  Logger, createLogger, configureLogger,
  GoliError, isGoliError, wrapUnknown,
  APP_NAME, APP_VERSION, APP_TAGLINE, CLI_BINARY_NAME,
  repairJson, parseJson,
} from "@goli-cli/shared";
```

### `@goli-cli/config` — configuration

```typescript
import { loadConfig, invalidateConfigCache } from "@goli-cli/config";
// loadConfig() reads config/default.toml → ~/.goli-cli/config.toml → GOLI_* env vars
```

### `@goli-cli/agent-core` — the agent loop

```typescript
import {
  AgentLoop, AgentRole, AGENT_ROLES, AGENT_ROLE_LABELS,
  ConversationState, StopReason, AgentEvent, Todo,
  ProviderBackedModelClient, createProviderBackedClientSync, createProviderBackedClient,
  BudgetTracker, StopEngine, StallDetector, LoopDetector, Planner, PLAN_TASK_TOOL,
  SystemPromptAssembler, ReflexionEngine, EffortRoutingClient,
  ToolsetSnapshot, ProvenanceTracker, TrustLevel, TRUST_RANK,
  callWithRetry, isRetryableError,
} from "@goli-cli/agent-core";
```

### `@goli-cli/llm-providers` — providers

```typescript
import {
  ModelProvider, ProviderConfig, Message, ToolCall, ModelResponse,
  OllamaProvider, AnthropicProvider, GeminiProvider, MockProvider, OpenAIProvider,
  createProvider, getDefaultModelSpec, isProviderLegallyBlocked,
} from "@goli-cli/llm-providers";
```

### `@goli-cli/tool-system` — tools, registry, hooks

```typescript
import {
  Tool, ToolRegistry, toToolDefinition,
  validateToolArgs, truncateResult, MAX_TOOL_RESULT_TOKENS,
  HookEngine, registerBuiltinHooks,
} from "@goli-cli/tool-system";
```

### `@goli-cli/sandbox` — OS-level isolation

```typescript
import {
  executeInSandbox, executeInSandboxAsync,
  NetworkEgressFilter, DEFAULT_NETWORK_ALLOWLIST,
  generateSeatbeltProfile, buildSeatbeltCommand,
  validatePath, isSymlink,
  appendAuditLog, readAuditLog, verifyAuditLog,
} from "@goli-cli/sandbox";
```

### `@goli-cli/context-engine` — retrieval & compaction

```typescript
import {
  TreeSitterIndexer, SymbolGraph, HybridRetriever,
  CompactionEngine, ProjectMapGenerator, createContextEngine,
} from "@goli-cli/context-engine";
```

### `@goli-cli/memory-engine` — memory & SICA

```typescript
import {
  PersistentMemory, SessionMemory, JsonlSessionStore,
  VectorMemoryPlugin, TFIDFMemoryPlugin, MemoryCurator,
  TrajectoryStore, TrajectoryCurator, DatasetBuilder, computeReward,
  SicaLoop, ImmutableSafetyRegistry, SafetyOverseer, SicaArchive,
  MEMORY_BUDGETS, TOTAL_MEMORY_BUDGET,
} from "@goli-cli/memory-engine";
```

### `@goli-cli/orchestration` — 11-agent swarm

```typescript
import {
  SwarmPipeline, SWARM_PIPELINE,
  TaskSplitter, WorktreeIsolation, SharedBlackboard,
  ComplexityClassifier, E2BSandbox, OrchestrationPatterns,
  SubagentIsolator, SUBAGENT_CONFIGS,
  BLOCKED_PROVIDERS, ALLOWED_PROVIDERS,
} from "@goli-cli/orchestration";
```

### `@goli-cli/evals` — evaluation harness

```typescript
import {
  SWEBenchHarness, SemanticErrorEvaluator, RegressionGate,
  generateRedteamConfig, evaluateRedteamResults,
} from "@goli-cli/evals";
```

### `@goli-cli/approval`, `@goli-cli/observability`, `@goli-cli/plugins`, `@goli-cli/i18n`

```typescript
import { ApprovalEngine, EnhancedApprovalEngine, computeBlastRadius } from "@goli-cli/approval";
import { OtelTracer, LangfuseClient, AlertManager } from "@goli-cli/observability";
import { PluginRegistry } from "@goli-cli/plugins";
import { initI18n, t, setLocale, getLocale, SUPPORTED_LOCALES } from "@goli-cli/i18n";
```

### `@goli-cli/sdk` — MCP SDK server & gateway

```typescript
import { ApiServer, HostProvider, HeadlessHostProvider } from "@goli-cli/sdk";
```

### Key module walkthrough

#### `AgentLoop` (`packages/agent-core/src/loop.ts`)

The core agent loop: receives user input, calls the model via the provider
adapter, executes tools, returns the final response. Handles streaming,
retries, error classification, stall detection, compaction, reflexion,
and effort routing.

```typescript
import { AgentLoop, createProviderBackedClientSync } from "@goli-cli/agent-core";
import { loadConfig } from "@goli-cli/config";
import { createDefaultToolRegistry } from "@goli-cli/tool-system";

const config = loadConfig();
const client = createProviderBackedClientSync(); // Ollama default
const tools = createDefaultToolRegistry({ workspaceRoot: process.cwd() });

const loop = new AgentLoop({
  client,
  tools,
  config,
  role: "implementer",
});

const result = await loop.run({
  prompt: "Fix the failing test in src/foo.ts",
});
// result: { content, tokens, costUsd, iterations, stopReason, todos }
```

#### `provider-adapter.ts` — Provider abstraction

Wraps any `ModelProvider` (Ollama / OpenAI / Anthropic / Gemini / Mock)
as a uniform model client that `AgentLoop` consumes. The provider is
selected via the `GOLI_DEFAULT_MODEL` env var (format `<provider>/<model>`):

```typescript
// Reads GOLI_DEFAULT_MODEL and constructs the right provider
const client = createProviderBackedClientSync();
// → OllamaProvider('gpt-oss:120b-cloud')     by default
// → OpenAIProvider('gpt-4o')                 if GOLI_DEFAULT_MODEL=openai/gpt-4o
// → AnthropicProvider('claude-3-5-sonnet')   if GOLI_DEFAULT_MODEL=anthropic/...
// → GeminiProvider('gemini-2.0-flash')       if GOLI_DEFAULT_MODEL=gemini/...
// → MockProvider('mock')                     if GOLI_DEFAULT_MODEL=mock/...
```

#### `registry.ts` (`@goli-cli/tool-system`) — Tool registry

Registers all built-in tools (bash, read_file, write_file, edit_file, grep,
list_directory, web_search, web_fetch, todo_write, ask_user, spawn_subagent,
notebook_edit, background_shell → bash_output/kill_shell, spec_write,
spec_review, spec_update, lsp_hover, lsp_goto_definition, lsp_references,
lsp_diagnostics) plus MCP tools added at runtime. Tools are tiered
(T0–T3 + BLK) by their blast radius.

```typescript
import { ToolRegistry, createDefaultToolRegistry } from "@goli-cli/tool-system";

const registry = createDefaultToolRegistry({
  workspaceRoot: process.cwd(),
  godMode: false,
  autoMode: false,
  sandboxMode: "workspace-write",
});
const tool = registry.get("bash");
```

#### `@goli-cli/sandbox` — Sandboxing

OS-level sandboxing via bubblewrap (`bwrap`, Linux) and Seatbelt /
sandbox-exec (macOS), with cgroups v2 resource limits and a
network egress filter. Native Linux Landlock syscalls are NOT used
(the `landlock.ts` file is misnamed — it wraps bubblewrap). Enforces
filesystem path allowlists, network allowlists, and resource caps
(memory / CPU / PIDs / disk / wallclock).

```typescript
import { executeInSandbox } from "@goli-cli/sandbox";
import { loadConfig } from "@goli-cli/config";

const result = await executeInSandbox("npm test", {
  workspaceRoot: process.cwd(),
  sandboxMode: "workspace-write",
  networkAllowlist: loadConfig().sandbox.networkAllowlist,
});
```

#### `@goli-cli/context-engine` — Context engine

Manages the LLM context window: hybrid retrieval (structural via SQLite
symbol graph + lexical via ripgrep + semantic via docstring matching,
fused via reciprocal rank fusion), 50% in-loop compaction + 85%
safety-net, project map indexing via tree-sitter (regex fallback or
optional native bindings per ADR-0046).

#### `@goli-cli/memory-engine` — Memory system

3-tier persistent memory:

- **Tier 1 (session):** `SessionMemory` (ephemeral in-process) + `JsonlSessionStore` (SQLite, crash-safe, supports resume + branch per ADR-0040).
- **Tier 2 (persistent):** `PersistentMemory` (3 markdown files: `MEMORY.md`, `USER.md`, `PROJECT.md` with hard character budgets per ADR-0025).
- **Tier 3 (external):** `VectorMemoryPlugin` / `TFIDFMemoryPlugin` (LanceDB deferred).

Plus: `MemoryCurator` (runs at session end), `TrajectoryStore` + `TrajectoryCurator` (training data), `DatasetBuilder` + `computeReward` (GRPO + LoRA fine-tuning pipeline in `services/ml-pipeline/`), `SicaLoop` + `ImmutableSafetyRegistry` + `SafetyOverseer` (recursive self-improvement with veto).

## @goli-cli/cli Public API

The CLI package exports the Ink-based TUI and the command-line entry point.
Lazy-loaded commands keep cold-start under 200ms (measured: 81ms).

### TUI component tree

```
<App>                          (root Ink component — ~768 lines)
├── <SplashBox>                (startup splash screen, ASCII art, agents list)
├── <HeaderBar>                (compact one-line: model + tokens + mode + tier + elapsed)
├── <HistoryScroll>            (memoized message list)
│   └── <MessageBubble>        (dispatcher — memoized)
│       ├── <UserMessage>      (green ● + content)
│       ├── <AgentMessage>     (agent header + tool calls + markdown content)
│       │   ├── <ToolMessage>  (sticky header + expandable output + status: ◷/✓/✗/⊘)
│       │   └── <DenseToolMessage> (compact one-line variant — GOLI_TUI_DENSE_TOOLS=1)
│       ├── <SystemMessage>    (ℹ/⚠/✗ + content)
│       ├── <ThinkingMessage>  (💭 + dim content)
│       ├── <ErrorMessage>     (✗ + content + optional code)
│       ├── <WarningMessage>   (⚠ + content)
│       └── <HintMessage>      (💡 + content)
├── <PromptInput>              (~839 lines — slash autocomplete + vim + paste compaction + completions)
│   └── <SuggestionsDisplay>   (filtered command list with kind suffixes + sections)
├── <StatusBar>                (model + tokens + [bar] + mode + tier + ⏱ — responsive)
├── <TokenBar>                 (reusable context-usage bar with color thresholds)
├── <LoadingIndicator>         (spinner + phrase + elapsed + cancel hint)
├── <Spinner>                  (5 styles: dots / line / arrow / bounce / triangle)
├── <ToastDisplay>             (Ctrl+C/Esc twice confirmations, 3s auto-dismiss)
├── <QueuedMessagesTray>       (Tab-queued messages with text + age)
├── <CommandPalette>           (Ctrl+P fuzzy command launcher)
├── <HelpPanel>                (? keymap reference, auto-generated)
├── <ShortcutsHelp>            (passive inline shortcuts panel — 3-column responsive)
├── <WelcomeTip>               (welcome row + tier-color legend)
├── <DialogManager>            (central dialog router with priority queue)
│   ├── <HelpDialog>           (wraps HelpPanel in a dismissible frame)
│   ├── <AboutDialog>          (version / license / homepage)
│   └── <ThemeDialog>          (theme picker — ↑↓/Enter/Esc)
├── <PermissionDialog>         (y/yes-once, a/yes-always, n/no, v/view, e/edit)
├── <DiffReviewDialog>         (per-hunk diff accept/reject — for edit_file/write_file)
├── <PolicyUpdateDialog>       (accept/ignore policy-integrity mismatch)
├── <CostBreakdownPanel>       (live cost: tokens in/out, USD, turns, $/1K rate)
├── <ContextSummaryDisplay>    (📄 N AGENTS.md · 🔌 N MCP · 🧠 N skills)
├── <ApprovalModeIndicator>    (BUILD/PLAN/SAFE/GOD chip with cycle hint)
├── <PipelineTrace>            (analyzing → routing → generating)
├── <FpsOverlay>               (debug FPS — GOLI_TUI_FPS=1)
├── <DebugProfiler>            (frame + idle-frame profiler — GOLI_TUI_DEBUG=1)
└── <ScreenReaderAppLayout>    (alternative a11y layout — linear, no animations)
```

The tree above is the initial **splash layout**. Once the user sends their
first message, the render tree is pruned for performance: `SplashBox`,
`AgentStateBar`, `ApprovalModeIndicator`, `ContextSummaryDisplay`,
`ShortcutsHelp`, and the dialogs unmount, leaving only `HeaderBar` +
`HistoryScroll` + `PromptInput`/`StatusBar` (~200 nodes per frame instead of
~500).

### Theme system

25 built-in themes (skins) — 21 standard (11 original + 10 added in T-043)
plus 4 Hermes-inspired additions
(`hermes-gold`, `ares-crimson`, `slate-cool`, `daylight`) — plus a
special `no-color` accessibility theme and user-defined YAML skins in
`~/.goli/skins/`:

```typescript
import {
  BUILTIN_SKIN_NAMES,
  BUILTIN_SKINS,
  getActiveSkin,
  loadSkin,
  NO_COLOR_SKIN,
} from "@goli-cli/cli/tui/theme/skin-engine";

// List all built-in skin names (25 entries)
const skinNames = BUILTIN_SKIN_NAMES; // ['default', 'dark', 'high-contrast', 'dracula', ...]

// Look up a Skin object by name (BUILTIN_SKINS is the Record<name, Skin> map)
const skin = BUILTIN_SKINS['monokai'];

// Get the active skin (GOLI_SKIN env var or --skin flag or ~/.goli/skins/<name>.yaml)
const active = getActiveSkin();

// Load a specific skin by name (case-insensitive)
const dracula = loadSkin("Dracula");

// Live hot-reload — no restart needed
// /theme command in the TUI applies the new skin immediately
```

The token palette (`apps/cli/src/tui/theme/tokens.ts`) is mutable and
version-tagged. Components subscribe via `useThemeVersion()` so `/theme`
triggers an immediate re-render.

### Vim mode

```typescript
import {
  vimHandleKey,
  initialVimState,
  vimModeLabel,
} from "@goli-cli/cli/tui/lib/vimMode";

let state = initialVimState(); // INSERT mode
state = vimHandleKey(state, "Esc", textLines).state; // → NORMAL
state = vimHandleKey(state, "i", textLines).state; // → INSERT
state = vimHandleKey(state, "v", textLines).state; // → VISUAL
// Supports: h/j/k/l, dd, i/a/A/I/o/O, v (visual), y (yank), p (paste)
```

### Slash commands

```typescript
import {
  globalCommands,
  registerDefaultCommands,
} from "@goli-cli/cli/tui/lib/CommandRegistry";

registerDefaultCommands();
// ~25 built-in commands registered: /help, /godmode, /safemode, /tier,
// /plan, /build, /compact, /clear, /quit, /inputmode, /theme, /design,
// /vim, /shortcuts, /tips, /about, /stats, /cost, /context, /memory,
// /model, /mcp, /doctor, /btw, /expand, /allowlist, /queue, /bg

const cmd = globalCommands.get("help");

globalCommands.register({
  name: "my-cmd",
  description: "My custom command",
  kind: "custom", // rendered as [custom] suffix
  sectionTitle: "Custom", // grouped under -- Custom --
  handler: (args) => {
    /* ... */
  },
});
```

Custom commands also load from `.goli/commands/*.md` (workspace) and
`~/.goli-cli/commands/*.md` (user) — markdown files with YAML frontmatter
and `$ARGUMENTS` / `$WORKSPACE` / `$DATE` substitution (ADR-0041).

### Markdown rendering

```typescript
import { renderMarkdown } from "@goli-cli/cli/tui/lib/markdown";

// Returns a React node for Ink
const node = renderMarkdown("# Title\n\n**bold** and `code`");
```

Supports: headings, code blocks (with syntax highlighting via
`code-highlight.ts` — 9 languages × 9 token kinds), bold, italic,
strikethrough, inline code, bullet lists (nested), ordered lists
(nested), blockquotes, GFM tables, links, LaTeX→Unicode symbol
preprocessing (~80 symbols: Greek, arrows, math ops, blackboard).

## @goli-cli/evals Public API

The evals package hosts the SWE-bench harness, semantic evaluator,
regression gate, and promptfoo red-team config generation (Phase 12):

```typescript
import {
  SWEBenchHarness,
  SemanticErrorEvaluator,
  RegressionGate,
  generateRedteamConfig,
  evaluateRedteamResults,
} from "@goli-cli/evals";

const harness = new SWEBenchHarness({
  // SWE-bench Verified instances
  // mini-swe-agent reference (ADR-0031) for leaderboard comparability
});
```

## Configuration

Goli-CLI uses TOML configuration layered as:
defaults → `config/default.toml` (project) → `~/.goli-cli/config.toml` (user) → `GOLI_*` env vars (highest precedence).

```toml
[model]
modelId = "gpt-oss:120b-cloud"     # overridden by GOLI_DEFAULT_MODEL env var
baseUrl = "https://ollama.com"
apiKey = ""                       # use GOLI_MODEL_API_KEY env var instead
defaultEffort = "high"            # routine tasks
complexEffort = "max"             # refactor / debug / architecture
complexTriggers = ["refactor", "design", "architecture", "debug", "migrate", "rewrite"]
maxContextTokens = 1_000_000
requestTimeoutMs = 120_000
streaming = true

[budget]
maxTokens = 800_000
maxCostUsd = 5.0
maxIterations = 50
maxWallclockSeconds = 1800

[retry]
maxRetries = 3
initialBackoffMs = 1000
backoffMultiplier = 2.0
maxBackoffMs = 30_000
jitterFactor = 0.5

[stall]
identicalCallThreshold = 3
windowSize = 5
maxParseFailures = 3

[sandbox]
mode = "workspace-write"          # read-only | workspace-write | danger-full-access
approvalPolicy = "on-request"     # on-request | on-failure | never
networkAllowlist = ["github.com:443", "pypi.org:443", "files.pythonhosted.org:443", "registry.npmjs.org:443", "crates.io:443"]
memoryMaxMb = 4096
cpuQuotaPercent = 200
pidMax = 512
diskMaxMb = 10_240
wallclockTimeoutS = 1800

[logging]
level = "info"
format = "pretty"
```

## Environment variables

| Variable                 | Description                                     | Default                    |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| `GOLI_HOME`              | Profile directory (overrides `~/.goli/current`) | `~/.goli-cli` (legacy)     |
| `GOLI_DEFAULT_MODEL`     | Active provider + model (`<provider>/<model>`)  | `ollama/gpt-oss:120b-cloud` |
| `OLLAMA_API_KEY`         | Ollama Cloud API key (default provider)         | (unset — read from `.env`) |
| `OPENAI_API_KEY`         | OpenAI API key (opt-in)                         | (unset)                    |
| `ANTHROPIC_API_KEY`      | Anthropic API key (opt-in)                      | (unset)                    |
| `GEMINI_API_KEY`         | Gemini API key (opt-in)                         | (unset)                    |
| `GOLI_MODEL_API_KEY`     | Generic API key (fallback for any provider)     | (unset)                    |
| `GOLI_SKIN`              | Active theme name                               | `default`                  |
| `GOLI_TUI_FPS`           | Show FPS overlay                                | `0` (off)                  |
| `GOLI_TUI_DEBUG`         | Show debug profiler + flicker detector          | `0` (off)                  |
| `GOLI_TUI_DENSE_TOOLS`   | Compact one-line tool renderings                | `0` (off)                  |
| `GOLI_TUI_HYPERLINKS`    | OSC-8 clickable hyperlinks                      | `0` (off)                  |
| `GOLI_TUI_HEAPMON`       | Heap-pressure watchdog                          | `0` (off)                  |
| `GOLI_CLI_ACCESSIBILITY` | Force screen-reader layout                      | (auto-detected)            |
| `NO_COLOR`               | Disable color output (also forces a11y layout)  | (unset)                    |
| `GOLI_CLI_DEBUG`         | Verbose CLI debug logging                       | (unset)                    |
| `GOLI_HEADLESS`          | Mark process as headless (suppresses TUI hooks) | (unset)                    |

## See also

- [TUI Architecture](../tui/architecture.md) — component tree, state management, performance
- [Themes](../cli/themes.md) — all 25 built-in themes with color palettes
- [Architecture Decisions](../decisions/) — 47 ADRs covering major design choices
- [Getting Started](../getting-started.md) — installation and first-run guide
- [Architecture](../architecture.md) — module map + agent loop internals
- [Agents](../agents.md) — 11-agent swarm pipeline (Scout → Documenter)
- [MCP Extensions](../extensions/mcp.md) — how to add custom tools via MCP servers
