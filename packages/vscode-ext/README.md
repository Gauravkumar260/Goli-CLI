# GOLI-CLI VS Code Extension (Module 7)

Integrates the GOLI-CLI agent into VS Code, providing:

- **Command palette integration** (`GOLI: Wake Up`, `GOLI: Review Batch Diff`)
- **Batch diff review panel** — approve/reject multiple file changes at once
- **Agent status panel** — tree view showing the agent's current state
- **Audit log viewer** — `GOLI: Show Audit Log` opens the audit log in a read-only editor
- **Usage indicator** — `GOLI: Show Token/Cost Usage` displays session stats

## Quick Start

```bash
# 1. Build the extension
cd packages/vscode-ext
npm install
npm run build

# 2. Package (requires vsce)
npx vsce package
# → produces goli-vscode-0.2.0.vsix

# 3. Install in VS Code
code --install-extension goli-vscode-0.2.0.vsix
```

Or for development:

```bash
# Open this folder in VS Code, then press F5 to launch an Extension Development Host.
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `goli.cliPath` | `""` | Path to the `goli` binary. If empty, uses `goli` from PATH. |
| `goli.defaultEffort` | `"high"` | Default reasoning effort (`low` / `high` / `max`). |
| `goli.sandboxMode` | `"workspace-write"` | Sandbox mode for tool execution. |
| `goli.autoApproveTier2` | `false` | Auto-approve Tier-2 (bash) commands without asking. |
| `goli.showBatchDiffOnGenerate` | `true` | Auto-show the batch diff panel when the agent generates changes. |

## Architecture

The extension does NOT reimplement the agent — it spawns the `goli` CLI
binary as a subprocess and communicates via stdout/stderr. This keeps
the TypeScript agent logic in one place (`packages/core`) and avoids
the maintenance burden of a parallel VS Code agent implementation.

```
┌─────────────────────────────────────────────┐
│  VS Code Extension (this package)           │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Extension   │  │ BatchDiffProvider    │  │
│  │ entry point │──│ (parses [FILE_CHANGE]│  │
│  │             │  │  events from stdout) │  │
│  └──────┬──────┘  └──────────────────────┘  │
│         │ spawn                              │
└─────────┼───────────────────────────────────┘
          ▼
   goli wakeup "<task>" --effort high --sandbox workspace-write
          │
          ▼
   packages/cli (Ink TUI or non-TUI mode)
          │
          ▼
   packages/core (agent loop, tools, sandbox)
```

## Batch Diff Review

The standout feature is the batch diff review panel. When the agent
edits multiple files in one turn, the panel shows all changes in a
single Webview with per-file approve/reject and bulk operations.

This is significantly faster than the single-file-at-a-time approval
flow that most AI coding tools use — reviewing 10 file changes in one
panel takes ~30 seconds, vs. ~3 minutes for 10 separate approval
prompts.

## Legal

MIT-licensed. Only open-weight models (GLM-5.2, DeepSeek, Qwen, Kimi)
are supported — see `docs/decisions/0034-open-weight-only-routing.md`.
