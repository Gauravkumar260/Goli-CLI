# Goli-CLI API Reference

> Entry point for API documentation. For auto-generated TypeDoc output,
> run `npm run docs:gen` (writes to `docs/api/_generated/`).

## Packages

Goli-CLI is an npm workspaces monorepo with 4 packages:

| Package           | Path                   | Description                                                                              |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `@goli/core`      | `packages/core/`       | The "Brain": agent loop, tools, safety, context, model providers, 8-agent orchestration |
| `@goli/cli`       | `packages/cli/`        | User-facing TUI (Ink/React), command parsing, binary distribution                        |
| `@goli/evals`     | `packages/evals/`      | Evaluation harness (SWE-bench-style, currently a stub)                                   |
| `goli-vscode-ext` | `packages/vscode-ext/` | Standalone VS Code extension (NOT in npm workspaces — see ADR-0017)                      |

## @goli/core Public API

The core package exports its public API from `packages/core/src/index.ts`,
organized by Phase:

```typescript
import {
  // ——— Utils (Phase 1) ———
  Logger,
  createLogger,
  configureLogger,
  GoliError,
  ModelError,
  ModelTimeoutError,
  ModelHTTPError,
  ToolValidationError,
  ToolExecutionError,
  SandboxError,
  SandboxDeniedError,
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  isGoliError,
  wrapUnknown,
  APP_NAME,
  APP_VERSION,
  APP_TAGLINE,
  CLI_BINARY_NAME,

  // ——— Config (Phase 1) ———
  loadConfig,
  AppConfig,
  AppConfigSchema,
  MODE_PROMPTS,
  getPromptForMode,
  PolicyIntegrityManager,

  // ——— Agent Core Loop (Phase 2) ———
  AgentLoop,
  AgentRole,
  AGENT_ROLES,
  AGENT_ROLE_LABELS,
  Message,
  MessageRole,
  ToolCall,
  ConversationState,
  StopReason,
  AgentEvent,
  Todo,
  ProviderBackedModelClient,
  createProviderBackedClientSync,
  createProviderBackedClient,
  BudgetTracker,
  StopEngine,
  StallDetector,
  LoopDetector,
  Planner,
  PLAN_TASK_TOOL,
  SystemPromptAssembler,
  applySystemAnd3Strategy,
  ReflexionEngine,
  EffortRoutingClient,
  ToolGuardrailController,
  AdvancedCompressor,
  classifyApiError,
  ClassifiedError,
  TERMINAL_AUTH_REASONS,
  CredentialPool,
  ToolsetSnapshot,
  ProvenanceTracker,
  TrustLevel,
  TRUST_RANK,
  repairJson,
  parseToolCallArgs,
  callWithRetry,

  // ——— Tool Layer (Phase 4) ———
  Tool,
  ToolResult,
  ToolContext,
  ToolDefinition,
  ToolInputSchema,
  PermissionTier,
  ToolRegistry,
  createDefaultToolRegistry,
  executeToolCallsConcurrent,
  validateToolArgs,
  truncateResult,
  MAX_TOOL_RESULT_TOKENS,
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  GREP_TOOL,
  BASH_TOOL,
  TODO_WRITE_TOOL,
  ASK_USER_TOOL,
  SPAWN_SUBAGENT_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  NOTEBOOK_EDIT_TOOL,
  SPEC_WRITE_TOOL,
  SPEC_REVIEW_TOOL,
  SPEC_UPDATE_TOOL,
  HookEngine,
  HookEvent,
  AUTO_FORMAT_HOOK,
  BLOCK_SECRETS_HOOK,
  BLOCK_DESTRUCTIVE_HOOK,
  BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK,
  GIT_CHECKPOINT_HOOK,
  AUDIT_LOG_HOOK,
  MCPClientManager,
  MCPServerConfig,
  MCPTool,

  // ——— Sandbox (Phase 5) ———
  SandboxMode,
  ApprovalPolicy,
  PermissionTier,
  ApprovalEngine,
  EnhancedApprovalEngine,
  computeBlastRadius,
  NetworkEgressFilter,
  DEFAULT_NETWORK_ALLOWLIST,
  isCgroupsV2Available,
  generateCgroupConfig,
  isLandlockSupported,
  generateSeatbeltProfile,
  buildSeatbeltCommand,
  generateBubblewrapCommand,
  isBubblewrapAvailable,
  validatePath,
  isSymlink,
  isSymlinkCreationCommand,
  appendAuditLog,
  readAuditLog,
  verifyAuditLog,
  getAuditLogSummary,
  executeInSandbox,

  // ——— Context Engine (Phase 7) ———
  TreeSitterIndexer,
  SymbolGraph,
  HybridRetriever,
  RetrievalResult,
  RetrievalStrategy,
  CompactionEngine,
  SubagentIsolator,
  ProjectMapGenerator,
  createContextEngine,
  isRealTreeSitterAvailable,
  extractChunksWithTreeSitter,

  // ——— Memory System (Phases 8–11) ———
  PersistentMemory,
  SessionMemory,
  JsonlSessionStore,
  MemoryCurator,
  VectorMemoryPlugin,
  TrajectoryStore,
  TrajectoryCurator,
  DatasetBuilder,
  computeReward,
  GRPOScaffold,
  SicaLoop,
  ImmutableSafetyRegistry,
  SafetyOverseer,
  SicaArchive,
  OverfitDetector,
  SicaRateLimiter,
  createMemorySystem,
  MEMORY_BUDGETS,
  TOTAL_MEMORY_BUDGET,

  // ——— Evals & Observability (Phase 12) ———
  SWEBenchHarness,
  SemanticErrorEvaluator,
  RegressionGate,
  generateRedteamConfig,
  configToYaml,
  evaluateRedteamResults,
  OtelTracer,
  LangfuseClient,
  AlertManager,

  // ——— Multi-Agent Orchestration (Phase 13) ———
  SwarmPipeline,
  TaskSplitter,
  WorktreeIsolation,
  SharedBlackboard,
  ComplexityClassifier,
  E2BSandbox,
  OrchestrationPatterns,
  BLOCKED_PROVIDERS,
  ALLOWED_PROVIDERS,

  // ——— API Server (H10) ———
  ApiServer,

  // ——— Plugin System (H11) ———
  PluginRegistry,
  pluginRegistry,

  // ——— Providers ———
  ModelProvider,
  OllamaProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  MockProvider,
  createProvider,
} from "@goli/core";
```

### Key modules

#### `agent/loop.ts` — The agent loop

The core agent loop: receives user input, calls the model via the provider
adapter, executes tools, returns the final response. Handles streaming,
retries, error classification, stall detection, compaction, reflexion,
and effort routing.

```typescript
import {
  AgentLoop,
  createProviderBackedClientSync,
  loadConfig,
  createDefaultToolRegistry,
} from "@goli/core";

const config = loadConfig();
const client = createProviderBackedClientSync(config); // Ollama default
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

#### `agent/provider-adapter.ts` — Provider abstraction

Wraps any `ModelProvider` (Ollama / OpenAI / Anthropic / Gemini / Mock)
as a uniform model client that `AgentLoop` consumes. The provider is
selected via the `GOLI_DEFAULT_MODEL` env var (format `<provider>/<model>`):

```typescript
// Reads GOLI_DEFAULT_MODEL and constructs the right provider
const client = createProviderBackedClientSync(config);
// → OllamaProvider('gpt-oss:120b') by default
// → OpenAIProvider('gpt-4o')        if GOLI_DEFAULT_MODEL=openai/gpt-4o
// → AnthropicProvider('claude-3-5-sonnet') if GOLI_DEFAULT_MODEL=anthropic/...
// → GeminiProvider('gemini-1.5-pro')       if GOLI_DEFAULT_MODEL=gemini/...
// → MockProvider('echo')                   if GOLI_DEFAULT_MODEL=mock/echo
```

#### `tools/registry.ts` — Tool registry

Registers all built-in tools (bash, read_file, write_file, edit_file, grep,
list_directory, web_search, web_fetch, todo_write, ask_user, spawn_subagent,
notebook_edit, background_shell, spec_write, spec_review, spec_update,
lsp_hover, lsp_goto_definition, lsp_references, lsp_diagnostics, plan_task)
plus MCP tools added at runtime. Tools are tiered (T0–T3 + BLK) by their
blast radius.

```typescript
import { ToolRegistry, createDefaultToolRegistry } from "@goli/core";

const registry = createDefaultToolRegistry({
  workspaceRoot: process.cwd(),
  godMode: false,
  autoMode: false,
  sandboxMode: "workspace-write",
});
const tool = registry.get("bash");
```

#### `sandbox/` — Sandboxing

OS-level sandboxing via bubblewrap (`bwrap`, Linux) and Seatbelt /
sandbox-exec (macOS), with cgroups v2 resource limits and a
network egress filter. Native Linux Landlock syscalls are NOT used
(the `landlock.ts` file is misnamed — it wraps bubblewrap). Enforces
filesystem path allowlists, network allowlists, and resource caps
(memory / CPU / PIDs / disk / wallclock).

```typescript
import { executeInSandbox, loadConfig } from "@goli/core";

const result = await executeInSandbox("npm test", {
  workspaceRoot: process.cwd(),
  sandboxMode: "workspace-write",
  networkAllowlist: loadConfig().sandbox.networkAllowlist,
});
```

#### `context/` — Context engine

Manages the LLM context window: hybrid retrieval (structural via SQLite
symbol graph + lexical via ripgrep + semantic via docstring matching,
fused via reciprocal rank fusion), 50% in-loop compaction + 85%
safety-net, project map indexing via tree-sitter (regex fallback or
optional native bindings per ADR-0046).

#### `memory/` — Memory system

3-tier persistent memory:

- **Tier 1 (session):** `SessionMemory` (ephemeral in-process) + `JsonlSessionStore` (crash-safe append-only, supports resume + branch per ADR-0040).
- **Tier 2 (persistent):** `PersistentMemory` (3 markdown files: `MEMORY.md`, `USER.md`, `PROJECT.md` with hard character budgets per ADR-0025).
- **Tier 3 (external):** `VectorMemoryPlugin` (keyword-matching stub; LanceDB deferred).

Plus: `MemoryCurator` (runs at session end), `TrajectoryStore` + `TrajectoryCurator` (training data), `DatasetBuilder` + `computeReward` + `GRPOScaffold` (GRPO + LoRA fine-tuning pipeline), `SicaLoop` + `ImmutableSafetyRegistry` + `SafetyOverseer` (recursive self-improvement with veto).

## @goli/cli Public API

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

### Theme system

25 built-in themes (skins) — 21 standard + 4 Hermes-inspired additions
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
} from "@goli/cli/tui/theme/skin-engine";

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

The token palette (`packages/cli/src/tui/theme/tokens.ts`) is mutable and
version-tagged. Components subscribe via `useThemeVersion()` so `/theme`
triggers an immediate re-render.

### Vim mode

```typescript
import {
  vimHandleKey,
  initialVimState,
  vimModeLabel,
} from "@goli/cli/tui/lib/vimMode";

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
} from "@goli/cli/tui/lib/CommandRegistry";

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
import { renderMarkdown } from "@goli/cli/tui/lib/markdown";

// Returns a React node for Ink
const node = renderMarkdown("# Title\n\n**bold** and `code`");
```

Supports: headings, code blocks (with syntax highlighting via
`code-highlight.ts` — 9 languages × 9 token kinds), bold, italic,
strikethrough, inline code, bullet lists (nested), ordered lists
(nested), blockquotes, GFM tables, links, LaTeX→Unicode symbol
preprocessing (~80 symbols: Greek, arrows, math ops, blackboard).

## @goli/evals Public API

The evals package is currently a stub (Phase 12 work lands in
`packages/core/src/evals/`, not here):

```typescript
import { EVALS_VERSION } from "@goli/evals";
// → '0.2.0-phase2'
```

The actual SWE-bench harness, semantic evaluator, regression gate, and
promptfoo red-team config generation live in `@goli/core`:

```typescript
import {
  SWEBenchHarness,
  SemanticErrorEvaluator,
  RegressionGate,
  generateRedteamConfig,
  evaluateRedteamResults,
} from "@goli/core";

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
modelId = "glm-5.2"              # overridden by GOLI_DEFAULT_MODEL env var
baseUrl = "https://open.bigmodel.cn/api/paas/v4"
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
| `GOLI_DEFAULT_MODEL`     | Active provider + model (`<provider>/<model>`)  | `ollama/gpt-oss:120b`      |
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
- [Themes](../cli/themes.md) — all 20 built-in themes with color palettes
- [Architecture Decisions](../decisions/) — 45 ADRs covering major design choices
- [Getting Started](../getting-started.md) — installation and first-run guide
- [Architecture](../architecture.md) — module map + agent loop internals
- [Agents](../agents.md) — 8-agent swarm pipeline (Orchestrator → Data)
- [MCP Extensions](../extensions/mcp.md) — how to add custom tools via MCP servers
