# Getting Started with Goli-CLI

> 5-minute tutorial. By the end, you'll have Goli-CLI installed, configured
> to talk to an LLM, and running your first task in the interactive TUI.

Goli-CLI is a production-grade, multi-agent coding assistant built with
TypeScript + [Ink](https://github.com/vadimdemedes/ink) (React for CLIs).
It ships with an interactive TUI, a headless mode for CI/CD, and pluggable
providers (Ollama, OpenAI, Anthropic, Gemini).

## Prerequisites

- **Node.js ≥ 20.18.0** — check with `node --version`. The CLI uses modern
  ESM + Node 20 APIs (crypto webcrypto, fetch, etc.).
- **npm ≥ 10** — comes bundled with Node.js 20.
- **ripgrep** _(optional)_ — used by the built-in `grep` tool.
  Install from <https://github.com/BurntSushi/ripgrep>.
- **git** _(optional)_ — used by worktree isolation and the `commit`
  command. Install from <https://git-scm.com>.
- **An LLM endpoint** — the default is [Ollama](https://ollama.com) Cloud
  (`ollama/gpt-oss:120b-cloud`). Any OpenAI-compatible endpoint works too
  (OpenAI, Anthropic, Gemini, vLLM, LM Studio, etc.).

## Step 1: Install

```bash
git clone https://github.com/goli-cli/goli-cli.git
cd goli-cli
npm install
npm run build
```

The build (via Turborepo) compiles every app and package to its own
`dist/`. The `npm run goli` script wires `node apps/cli/dist/index.js`
to a local `goli` invocation.

Verify the install:

```bash
npm run goli -- --version
# → goli 0.2.0-phase2 — Multi-Agent Software Swarm
```

> **First time?** Run `bash scripts/clean-room-verify.sh` — it exercises the
> exact install→build→`--version`→`--help`→invariants flow and exits 0 on
> success.

## Step 2: Configure `.env`

Goli-CLI auto-loads `.env` from your CWD and from the `apps/cli/`
directory on startup (existing process env vars take precedence). The
repository ships with a working `.env` pointed at Ollama Cloud — open it
and tweak as needed:

```bash
# .env — Goli-CLI API configuration

# Default model: "ollama/gpt-oss:120b-cloud" (gpt-oss via Ollama Cloud)
# Other supported providers:
#   openai/gpt-4o
#   anthropic/claude-3-5-sonnet
#   gemini/gemini-2.0-flash
GOLI_DEFAULT_MODEL=ollama/gpt-oss:120b-cloud

# Ollama endpoint + API key (used when GOLI_DEFAULT_MODEL starts with ollama/)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=<your-ollama-cloud-key>   # https://ollama.com/settings/keys

# Keys for the other providers (only needed when you switch to them):
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Sandbox execution environment: 'docker' or 'local' (default: local)
GOLI_SANDBOX=local
```

### Switching providers

To change providers, edit `GOLI_DEFAULT_MODEL` in `.env` and supply the
matching API key. The provider prefix (`ollama/`, `openai/`,
`anthropic/`, `gemini/`) selects the provider; the suffix is the model
name passed to that provider.

| `GOLI_DEFAULT_MODEL`            | Required env var(s)                 |
| ------------------------------- | ----------------------------------- |
| `ollama/gpt-oss:120b-cloud` (default) | `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` |
| `openai/gpt-4o`                 | `OPENAI_API_KEY`                    |
| `anthropic/claude-3-5-sonnet`   | `ANTHROPIC_API_KEY`                 |
| `gemini/gemini-2.0-flash`       | `GEMINI_API_KEY`                    |

The provider is wired through `packages/agent-core/src/provider-adapter.ts`,
which wraps the `ModelProvider` interface as a `ProviderBackedModelClient` so the agent
loop can use any provider without code changes.

## Step 3: Run a health check

```bash
npm run goli -- doctor
```

`goli doctor` verifies:

- Node.js version meets `>=20.18.0`
- ripgrep is on `PATH` (warns if missing — non-fatal)
- git is installed and the CWD is a git repo (optional)
- The configured model endpoint is reachable
- API keys / base URLs are present in `.env`
- The sandbox backend (local or docker) is available

Fix any red items before proceeding; yellow warnings are non-fatal.

## Step 4: Try demo mode (no API needed)

Want to see the agent loop without configuring a provider? Run:

```bash
npm run goli -- --demo -p "hello"
```

This launches `MockAgentLoop` — a scripted `INIT → PLAN → TOOL → GEN → DONE`
event sequence that exercises the full event pipeline end-to-end without
calling any LLM. Use it for:

- First-run onboarding (see the agent flow with zero setup)
- Screenshot/CI smoke testing (deterministic output)
- Verifying the install before plugging in real API keys

> The `--demo` flag takes precedence over `-p`. The mock agent uses its own
> built-in prompt; the `-p "hello"` is accepted for command compatibility
> but is not sent to a real model.

## Step 5: Launch the TUI

```bash
npm run goli -- wakeup
```

`goli wakeup` is the primary command — it launches the Ink TUI and starts
the agent pipeline (Scout → Researcher → Architect → Planner → Implementer
→ Debugger → QA → Security → Reviewer → Orchestrator → Documenter). With
no prompt argument, it opens the interactive chat UI.

You'll see a splash screen with the active model, workspace, git branch,
and session ID. Once you send your first message, the splash collapses to
a compact header bar.

### Headless mode (CI/CD)

For non-interactive use, pass `-p` / `--print`:

```bash
# Print the result to stdout and exit
npm run goli -- -p "Explain what this codebase does in 3 sentences"

# JSON output for pipelines
npm run goli -- -p "List the exported functions" --output-format json

# Read prompt from stdin
echo "Find all TODO comments" | npm run goli -- -p -
```

## Step 6: First steps inside the TUI

Once the TUI is open, try this sequence:

1. **Type a message** — e.g. `hello` — and press **Enter**. The agent
   will respond in the history scroll. Streaming tokens appear in
   real-time; tool calls render as collapsible bubbles.

2. **Type `/help`** — opens the help panel listing every slash command
   (`/tier`, `/godmode`, `/compact`, `/vim`, `/theme`, `/tips`,
   `/doctor`, etc.).

3. **Type `/theme`** — opens the `ThemeDialog` overlay. Pick any of the
   25 built-in themes (Dracula, Nord, Solarized, GitHub, Atom One Dark,
   Monokai, etc.). Themes hot-reload instantly — no restart needed.

4. **Type `/tips`** — cycles through a curated list of productivity tips
   (keyboard shortcuts, hidden commands, workflow hints).

5. **Type `/doctor`** — runs the same health check as the CLI `goli doctor`
   command, in-app. Useful for diagnosing provider/sandbox issues mid-chat.

### Slash-command autocomplete

Typing `/` shows all commands. Typing `/he` filters to commands whose
name starts with `he` (e.g. `help`). Use ↑/↓ to navigate, **Tab** to
accept as a prefix (`/help `), **Enter** to dispatch.

## Step 7: Key shortcuts

| Key         | Action                                                            |
| ----------- | ----------------------------------------------------------------- |
| `Ctrl+R`    | Reverse-search through prompt history (Ctrl+R again = next match) |
| `Ctrl+P`    | Command palette — fuzzy-search every slash command                |
| `Ctrl+O`    | Open `$EDITOR` (or `$VISUAL`) for multi-line prompt editing       |
| `Ctrl+G`    | Toggle god mode (maximum autonomy)                                |
| `Ctrl+L`    | Clear the screen                                                  |
| `Ctrl+S`    | Toggle mouse-scroll mode (wheel to scroll history)                |
| `Ctrl+C`    | Abort current turn; press twice within 1.5s to exit               |
| `Ctrl+D`    | Exit when the prompt is empty                                     |
| `Ctrl+Z`    | Suspend to background (Unix; resume with `fg`)                    |
| `Ctrl+\`    | Toggle design (splash ↔ compact header)                           |
| `Shift+Tab` | Cycle permission mode: SAFE → GOD → PLAN                          |
| `Esc`       | Close dialog / abort; press twice to clear the prompt             |
| `?`         | Toggle the shortcuts help panel                                   |
| `Up/Down`   | Navigate prompt history (or active suggestion when `/` is active) |
| `/vim`      | Toggle vim mode (INSERT/NORMAL/VISUAL)                            |

### Inline completions

Two prefix characters unlock inline tab-completion in the prompt:

- **`@`** — file-path completion. Type `@src/` and press **Tab** to list
  files/dirs under `src/`. Selecting one inserts the relative path.
- **`!`** — shell-command completion. Type `!git ` and press **Tab** to
  list git subcommands (`add`, `commit`, `push`, …). Also works for
  `npm`. Falls back to scanning `$PATH` for binaries.

## Step 8: Add an MCP extension (optional)

MCP (Model Context Protocol) servers extend Goli-CLI with custom tools.
Try the hello-world example:

```bash
npm run goli -- mcp add hello-world \
  --transport stdio \
  --command node \
  --args $(pwd)/examples/mcp-hello-world/server.js

npm run goli -- mcp list
npm run goli -- -p "Use the greet tool to say hello to Alice"
```

See [MCP Extensions](extensions/mcp.md) for the full guide.

## Common workflows

### "Fix a bug"

```bash
npm run goli -- -p "Fix the failing test in packages/context-engine/__tests__/tree-sitter-indexer.test.ts. \
The test expects 'hello world' but gets 'hello  world' (double space)."
```

### "Refactor a module"

```bash
npm run goli -- wakeup "Refactor src/auth/ to use JWT instead of session cookies"
# In the TUI: review the diff in the DiffReviewDialog, press (a)ccept or (r)eject
```

### "Review a PR"

```bash
npm run goli -- -p "Review the diff in the current git branch. Focus on \
security, error handling, and test coverage." --output-format json
```

## Troubleshooting

### `goli doctor` reports missing ripgrep

Install ripgrep:

- macOS: `brew install ripgrep`
- Ubuntu/Debian: `apt install ripgrep`
- Windows: `scoop install ripgrep` or `choco install ripgrep`

### `Unknown provider type` or model errors

Check that `GOLI_DEFAULT_MODEL` uses a supported prefix (`ollama/`,
`openai/`, `anthropic/`, `gemini/`) and that the matching `*_API_KEY`
env var is set. Run `npm run goli -- doctor` to validate.

### TUI won't launch in CI / pipes

Ink requires a real TTY. If you see _"Cannot launch TUI: stdin and
stdout are not a TTY"_, use headless mode (`-p "<prompt>"`) instead.

### Cold-start is slow (> 200ms)

Run `npm run bench:quick` to diagnose. The lazy-loading optimization in
`apps/cli/src/index.ts` should keep cold-start under 200ms — if it's
slow, check that `@goli-cli/agent-core` isn't being eagerly imported at the top
of any CLI entry file.

### Tests fail with "Cannot find module '@goli-cli/agent-core'"

Run `npm run build` first — the CLI depends on `@goli-cli/agent-core/dist/`, which
is built from `packages/agent-core/src/`. See `AGENTS.md` for build-chain gotchas.

## Next steps

- [TUI Architecture](tui/architecture.md) — component tree, performance,
  state management.
- [Themes](cli/themes.md) — the 25 built-in themes + custom YAML skins.
- [Agents](agents.md) — per-agent reference.
- [MCP Extensions](extensions/mcp.md) — write your own tools.
- [Contributing](../CONTRIBUTING.md) — how to contribute to Goli-CLI.
