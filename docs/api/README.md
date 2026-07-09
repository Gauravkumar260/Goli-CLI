# Goli-CLI API Reference

> Auto-generated documentation for the Goli-CLI public API surface.
>
> This file is the entry point for API documentation. For auto-generated
> TypeDoc output (if available), see `docs/api/_generated/`.

## Packages

Goli-CLI is a npm workspaces monorepo with 4 packages:

| Package | Path | Description |
|---------|------|-------------|
| `@goli/core` | `packages/core/` | The "Brain": agent loop, tools, safety, context, model providers, 11-agent orchestration |
| `@goli/cli` | `packages/cli/` | User-facing TUI (Ink/React), command parsing, binary distribution |
| `@goli/evals` | `packages/evals/` | Evaluation harness (SWE-bench-style) |
| `goli-vscode-ext` | `packages/vscode-ext/` | VS Code extension (NOT in npm workspaces) |

## @goli/core Public API

The core package exports its public API from `packages/core/src/index.ts`:

```typescript
import {
  // Agent loop
  AgentLoop,
  AgentEvent,
  AgentConfig,
  // Tools
  Tool,
  ToolRegistry,
  // Safety
  Sandbox,
  ApprovalEngine,
  // Context
  ContextEngine,
  CompactionEngine,
  // Memory
  MemorySystem,
  TrajectoryStore,
  // Config
  loadConfig,
  // MCP
  McpClient,
} from '@goli/core';
```

### Key modules

#### `agent/loop.ts` — The agent loop

The core agent loop: receives user input, calls the LLM, executes tools,
returns the final response. Handles streaming, retries, error classification,
and stall detection.

```typescript
const loop = new AgentLoop({
  model: 'claude-sonnet-4-6',
  tier: 'T1',
  mode: 'SAFE',
});
const response = await loop.run('Fix the failing test in src/foo.ts');
```

#### `tools/registry.ts` — Tool registry

Registers all built-in tools (bash, read_file, write_file, edit_file, grep,
web_search, web_fetch, etc.) plus MCP tools. Tools are tiered (T0-T3) by
their blast radius.

```typescript
const registry = new ToolRegistry();
registry.register(myCustomTool);
const tool = registry.get('bash');
```

#### `sandbox/` — Sandboxing

OS-level sandboxing via Landlock (Linux), Seatbelt (macOS), and Windows
Sandbox Manager. Enforces filesystem path allowlists and network egress
rules.

#### `context/` — Context engine

Manages the LLM context window: hybrid retrieval (semantic + lexical),
compaction at 70% threshold, project map indexing via tree-sitter.

#### `memory/` — Memory system

Persistent memory: session JSONL store, trajectory curator, SICA
(self-improving code archive), training dataset builder.

## @goli/cli Public API

The CLI package exports the Ink-based TUI and the command-line entry point.

### TUI component tree

```
<App>                          (root Ink component)
├── <SplashBox>                (startup splash screen)
├── <HeaderBar>                (model + tokens + mode + tier)
├── <AgentStateBar>            (agent pipeline status + Spinner when busy)
├── <ToastDisplay>             (Ctrl+C/Esc twice confirmations)
├── <HistoryScroll>            (Static + LiveStream)
│   └── <MessageBubble>        (dispatcher)
│       ├── <UserMessage>      (green ● + content)
│       ├── <AgentMessage>     (agent header + tool calls + markdown content)
│       │   └── <ToolMessage>  (status + name + tier + arg + expandable output)
│       ├── <SystemMessage>    (ℹ/⚠/✗ + content)
│       ├── <ThinkingMessage>  (💭 + dim content)
│       ├── <ErrorMessage>     (✗ + content + optional code)
│       ├── <WarningMessage>   (⚠ + content)
│       └── <HintMessage>      (💡 + content)
├── <PromptInput>              (input row + slash-command autocomplete + history)
│   └── <SuggestionsDisplay>   (filtered command list with kind suffixes + sections)
├── <StatusBar>                (model + tokens + mode + tier + cwd + cost + branch)
└── <HelpPanel>                (? keymap reference)
```

### Theme system

21 built-in themes (skins) + user-defined YAML skins in `~/.goli/skins/`:

```typescript
import { BUILTIN_SKINS, getActiveSkin, loadSkin } from '@goli/cli/tui/theme/skin-engine';

// List all skins
const skins = BUILTIN_SKINS; // 21 entries

// Get the active skin (GOLI_SKIN env var or --skin flag)
const active = getActiveSkin();

// Load a specific skin by name (case-insensitive)
const dracula = loadSkin('Dracula');
```

### Vim mode

```typescript
import { vimHandleKey, initialVimState, vimModeLabel } from '@goli/cli/tui/lib/vimMode';

let state = initialVimState(); // INSERT mode
state = vimHandleKey(state, 'Esc', textLines).state; // → NORMAL
state = vimHandleKey(state, 'i', textLines).state;   // → INSERT
```

### Slash commands

```typescript
import { globalCommands, registerDefaultCommands } from '@goli/cli/tui/lib/CommandRegistry';

registerDefaultCommands();
const cmd = globalCommands.get('help');
globalCommands.register({
  name: 'my-cmd',
  description: 'My custom command',
  kind: 'custom',           // T-044: rendered as [custom] suffix
  sectionTitle: 'Custom',   // T-044: grouped under -- Custom --
  handler: (args) => { /* ... */ },
});
```

### Markdown rendering

```typescript
import { renderMarkdown } from '@goli/cli/tui/lib/markdown';

// Returns a React node for Ink
const node = renderMarkdown('# Title\n\n**bold** and `code`');
```

Supports: headings, code blocks, bold, italic, inline code, bullet lists
(nested), ordered lists (nested), blockquotes, GFM tables, links.

## @goli/evals Public API

The evals package provides a SWE-bench-style evaluation harness.

```typescript
import { EvalRunner } from '@goli/evals';

const runner = new EvalRunner({
  dataset: 'swe-bench-lite',
  model: 'claude-sonnet-4-6',
});
const results = await runner.run();
```

## Configuration

Goli-CLI uses TOML configuration in `~/.goli/config.toml` (or `GOLI_HOME`):

```toml
[model]
default = "claude-sonnet-4-6"
fallback = "claude-sonnet-4-6"

[safety]
tier = "T1"  # T0 (read-only) | T1 (sandboxed) | T2 (ask) | T3 (god)
sandbox = true

[context]
compaction_threshold = 0.7  # compact at 70% of context window
max_tokens = 200000

[tui]
skin = "default"  # any of 21 built-ins or ~/.goli/skins/<name>.yaml
vim_mode = false
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOLI_HOME` | Profile directory (overrides ~/.goli/current) | `~/.goli-cli` (legacy) |
| `GOLI_SKIN` | Active skin name | `default` |
| `GOLI_TUI_FPS` | Show FPS overlay | `0` (off) |
| `GOLI_TUI_NO_SCREEN_READER` | Disable screen-reader layout | (auto-detected) |

## See also

- [TUI Architecture](../tui/architecture.md) — component tree, state management, performance
- [Themes](../cli/themes.md) — all 21 built-in themes with color palettes
- [Architecture Decisions](../decisions/) — 46 ADRs covering major design choices
- [Getting Started](../getting-started.md) — installation and first-run guide
