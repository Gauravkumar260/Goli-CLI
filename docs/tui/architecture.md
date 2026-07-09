# Goli-CLI TUI Architecture

This document describes the architecture of the Goli-CLI terminal user
interface (TUI), built with [Ink](https://github.com/vadimdemedes/ink)
(React for CLIs).

## Component tree

The TUI has two top-level layouts: a **splash layout** shown on first
launch, and a **compact layout** shown once the user sends their first
message. `Ctrl+\` toggles between them at any time.

```
<App>                                  Root Ink component
│
├─ Splash layout (showDesign=true) ─────────────────────────────────
│   ├── <SplashBox>                    Startup splash (model, workspace, branch)
│   ├── <AgentStateBar>                Agent pipeline + Spinner when busy
│   ├── <WelcomeTip>                   First-run tip row
│   └── <ShortcutsHelp>                Passive shortcuts hint (idle 2s)
│
└─ Compact layout (showDesign=false) ───────────────────────────────
    ├── <HeaderBar>                    One-line header: model · mode · tier · tokens
    ├── <ToastDisplay>                 Transient notifications (Ctrl+C/Esc twice)
    ├── <HistoryScroll>                Conversation log
    │   ├── <Static>                   Completed messages (immutable scrollback)
    │   └── <MessageBubble>            Live streaming message dispatcher
    │       ├── <UserMessage>          Green ● + content
    │       ├── <AgentMessage>         Agent header + tool calls + markdown
    │       │   ├── <DenseToolMessage> Compact 1-line tool view (collapsible)
    │       │   └── <ToolMessage>      Full tool-call bubble (expandable)
    │       ├── <SystemMessage>        ℹ/⚠/✗ + content
    │       ├── <ThinkingMessage>      💭 + dim content (chain-of-thought)
    │       ├── <ErrorMessage>         ✗ + content + optional error code
    │       ├── <WarningMessage>       ⚠ + content
    │       └── <HintMessage>          💡 + content (contextual tips)
    ├── <LoadingIndicator>             Busy spinner + elapsed time + cancel hint
    ├── <PromptInput>                  Input row + autocomplete + history
    │   └── <SuggestionsDisplay>       Filtered command list + section headers
    ├── <StatusBar>                    cwd · model · tokens · mode · tier · cost · branch
    └── <QueuedMessagesTray>           Tab-queued follow-ups (visible when non-empty)

Overlays (rendered above the layout when active) ───────────────────
    ├── <HelpPanel>                    ? — keymap reference
    ├── <CommandPalette>               Ctrl+P — fuzzy command search
    ├── <ThemeDialog>                  /theme — 20-theme picker
    ├── <AboutDialog>                  /about
    ├── <PermissionDialog>             Per-tool approval prompt
    ├── <DiffReviewDialog>             Per-edit unified diff (a)ccept / (r)eject
    ├── <PipelineTrace>                Agent pipeline visualization (debug)
    ├── <DebugProfiler>                Render-time profiler (GOLI_CLI_DEBUG=1)
    └── <FpsOverlay>                   FPS counter (GOLI_TUI_FPS=1)
```

### Clean layout after splash

The splash layout (SplashBox + AgentStateBar + WelcomeTip) is replaced
by the compact layout the moment the user sends their first message.
Once collapsed, the visible chrome is just:

1. **`<HeaderBar>`** — one compact row with the model, mode, tier, and
   token bar.
2. **`<HistoryScroll>`** — the conversation log (completed messages in
   `<Static>`, the live streaming message in `<MessageBubble>`).
3. **`<PromptInput>`** + **`<StatusBar>`** — the input box and the
   bottom status row, wrapped together in a single bordered `<Box>` so
   they read as one unit.

Everything else (`<QueuedMessagesTray>`, dialogs, toasts, palette) only
mounts when there is something to show. Idle frames render only those
three primary regions — that's the whole TUI surface.

## New components (T-068 through T-096)

A series of focused improvements wired new components into the tree
without disturbing the existing layout. Each is gated by an explicit
condition so it never renders when empty:

| Component            | Module                                             | Trigger                                                        |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `CommandPalette`     | `components/CommandPalette.tsx` (T-081)            | `Ctrl+P`                                                       |
| `DenseToolMessage`   | `components/messages/DenseToolMessage.tsx` (T-077) | Tool in the compact allowlist + `GOLI_TUI_DENSE_TOOLS=1`       |
| `QueuedMessagesTray` | `components/QueuedMessagesTray.tsx` (T-095)        | `snap.queuedMessages.length > 0`                               |
| `CostBreakdownPanel` | `components/CostBreakdownPanel.tsx` (T-096)        | `/cost` command (or future auto-show on token threshold)       |
| `DiffReviewDialog`   | `components/DiffReviewDialog.tsx` (T-068)          | Permission with `diffEntry` payload + user presses `View diff` |
| `ThemeDialog`        | `components/dialogs/ThemeDialog.tsx` (T-058)       | `/theme` command                                               |
| `LoadingIndicator`   | `components/LoadingIndicator.tsx` (T-070)          | `isBusy`                                                       |
| `ShortcutsHelp`      | `components/ShortcutsHelp.tsx`                     | Splash layout, idle ≥ 2s                                       |

All five components the user interacts with most (`CommandPalette`,
`DenseToolMessage`, `QueuedMessagesTray`, `CostBreakdownPanel`,
`DiffReviewDialog`) are wired end-to-end:

- **`CommandPalette`** subscribes to the global `CommandRegistry`,
  fuzzy-filters by name or description, dispatches on Enter.
- **`DenseToolMessage`** collapses read_file/edit_file/grep/etc. to a
  single line (`✓ edit_file · T1 · src/foo.ts (+5 -2)`). `Ctrl+O` or
  `/expand` toggles the full diff/output payload.
- **`QueuedMessagesTray`** shows Tab-queued follow-ups with their text
  (truncated) and age ("5s ago"), so the user knows what's queued
  before the next turn.
- **`CostBreakdownPanel`** renders tokens / cost / per-turn average /
  cost rate, fed by `snap.inputTokens` / `snap.outputTokens` /
  `snap.totalCostUsd`.
- **`DiffReviewDialog`** pre-computes a unified diff via
  `computeDiff(oldContent, newContent)` and offers per-change
  `(a)ccept` / `(r)eject` plus bulk `(A)ccept all` / `(R)eject all`.

## State management

Goli-CLI uses a hybrid state architecture:

### `AppStateStore` (singleton)

`packages/cli/src/tui/state/AppStateStore.ts` — a singleton store that
holds the global app state: session, model, tokens, mode, tier, active
agents, permission mode, queued messages, paste placeholder, compact
hint, pending permission, total cost, input/output token counts.

Components subscribe via `useAppState()` which returns a snapshot.
Updates emit to all subscribers.

### Local component state

Each component owns its own local state:

- `App.tsx`: `messages`, `showWelcome`, `showDesign`, `showHelp`, toast
  state, `showDiffReview`, `activeDialog` (`'theme' | 'about' | null`),
  `vimEnabled`, `reverseSearchActive`, `showCommandPalette`,
  `mouseEnabled`.
- `PromptInput.tsx`: `value` (input text), `activeSuggestionIndex`,
  `compactPaste`.
- `AgentStateBar.tsx`: `spinIdx` (via `useSpinIndex` hook).

### Refs to avoid stale closures

`useInput` handlers capture state at registration time. To avoid stale
closures, we mirror state into refs:

```typescript
const valueRef = useRef(value);
valueRef.current = value;
// In useInput handler: use valueRef.current, not value
```

This pattern is used for `messagesRef`, `promptValueRef`,
`setPromptValueRef`, `compactPasteRef`, `togglePasteExpandRef`, and
`autoSubmitDoneRef`.

## Performance architecture

### `<Static>` for completed messages

`HistoryScroll` uses Ink's `<Static>` component for completed messages.
`<Static>` renders items ONCE to stdout and never touches them again.
This means:

- Terminal scrolling works naturally (emulator scrolls when stdout
  overflows).
- Each frame Ink recomputes only the streaming message + prompt/status
  (a few hundred nodes max).
- 1000-message history = **O(1) cost per render frame**.

A separate `LiveStream` component renders the single in-flight
streaming message; it is wrapped in `React.memo` so completed messages
never re-render when new tokens stream in.

### 200ms stream batching

`useAgentLoop` (`packages/cli/src/tui/hooks/useAgentLoop.ts`) does not
push a `setMessages` call per LLM token. Incoming text deltas are
accumulated into a `pendingText` buffer and flushed on a throttled
schedule:

```typescript
const STREAM_FLUSH_INTERVAL_MS = 200; // 5 flushes/sec
```

- If the buffer is small, flushes are coalesced via `setImmediate`
  (one React update per event-loop tick).
- If the buffer grows past the cap, a `setTimeout(flush, delay)` paces
  updates to at most one every 200ms.
- Tool events (status changes, completions) flush **immediately** —
  state changes can't wait.
- On turn end or abort, a final flush drains the buffer so the user
  sees the complete response.

Without batching, a fast streaming model could trigger 50+ full tree
renders per second. At 200ms the perceived latency is below the
threshold for text streaming and render work drops by ~3x.

### `React.memo` on every panel

Every message renderer (`UserMessage`, `AgentMessage`, `SystemMessage`,
`ToolMessage`, `DenseToolMessage`, `ThinkingMessage`, `ErrorMessage`,
`WarningMessage`, `HintMessage`) is wrapped in `React.memo`. Combined
with stable key props, completed messages NEVER re-render when new
messages stream in. Panels like `HeaderBar`, `StatusBar`,
`CostBreakdownPanel`, and `QueuedMessagesTray` are also memoized —
they only re-render when their specific props change.

### `indexOf`-based line splitter

During streaming, `AgentMessage` uses an `indexOf`-based line splitter
instead of `content.split('\n')` to avoid allocating a fresh array + N
substrings on every render frame. At 60fps with a 4KB message, that's
~240KB/s of GC pressure avoided.

### `useMemo` for derived state

`PromptInput` memoizes `filteredSuggestions` on `[allCommands, value]`
so the filter only recomputes when the input changes, not on every
render (e.g. status bar ticks). `CommandPalette` memoizes its filter
on `[commands, query]` with the same pattern.

### `batchedScroll` for scroll-into-view

`lib/batchedScroll.ts` coalesces same-tick `scrollIntoView()` calls.
When multiple parts of the TUI request a scroll in the same event-loop
tick (tool result + status update + new message), only ONE scroll
update reaches the setter — via `queueMicrotask`. The batching is
always-on and cheap.

### Spinner only mounts when busy

`AgentStateBar` renders `<Spinner>` only when `busy=true`. When idle,
it renders a static `SPIN[spinIdx] idle` text, avoiding an
unnecessary `setInterval` slot.

## Provider integration (`provider-adapter.ts`)

The agent loop expects a `GLMClient`-shaped object. The
`ModelProvider` interface (`packages/core/src/providers/ModelProvider.ts`)
exposes a different surface (`complete()`, `modelId()`,
`supportsCaching()`). `packages/core/src/agent/provider-adapter.ts`
bridges the two:

```
GOLI_DEFAULT_MODEL=ollama/gpt-oss:120b
        │
        ▼
createProviderBackedClientSync()    (sync; supports ollama/openai/anthropic)
   or
createProviderBackedClient()        (async; also supports gemini)
        │
        ▼
new OllamaProvider / OpenAIProvider / AnthropicProvider / GeminiProvider
        │
        ▼
new ProviderBackedGLMClient(provider)
        │
        ▼
new AgentLoop({ client, ... })
```

`ProviderBackedGLMClient.call()` translates the GLM-style `Message[]`
and tool definitions into the provider's format, invokes
`provider.complete()`, then maps the `ModelResponse` back to a
`GLMResponse` (content, toolCalls, inputTokens, outputTokens,
finishReason). Streaming tokens are forwarded through `onToken` →
`onChunk({ contentDelta })`.

`getProviderTypeFromEnv()` reads `GOLI_DEFAULT_MODEL` and returns the
provider prefix (`ollama`, `openai`, `anthropic`, `gemini`) or `null`
if the value points at a GLM model. This is what lets the same
`AgentLoop` work with Ollama, OpenAI, Anthropic, and Gemini without
code changes — see [Getting Started](../getting-started.md) for the
provider switch matrix.

## New hooks

| Hook                       | Module                                      | Purpose                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useThemeVersion`          | `hooks/useThemeVersion.ts` (T-076)          | Subscribes to `themeVersionCounter`; re-renders `App` on `applySkinToTokens()` so live theme switches propagate.                                                                             |
| `useExpandedTools`         | `hooks/useExpandedTools.ts` (T-091)         | Returns the `Set<string>` of expanded tool-call IDs; re-renders when `/expand` or `Ctrl+O` toggles one.                                                                                      |
| `useMouseScroll`           | `hooks/useMouseScroll.ts` (T-099)           | Enables SGR mouse tracking (`\x1B[?1000h` + `\x1B[?1006h`) and translates wheel events into `onScroll(delta)` callbacks. Toggled by `Ctrl+S`.                                                |
| `useContextCounts`         | `hooks/useContextCounts.ts` (T-100)         | Scans the filesystem for real counts of memory files (AGENTS.md/GOLI.md/CLAUDE.md/.cursor/rules), MCP servers (from `.goli/mcp.json`), and skills (`.goli/skills/*.md`). Re-scans every 30s. |
| `useKittyKeyboardProtocol` | `hooks/useKittyKeyboardProtocol.ts` (T-105) | Detects + enables the Kitty keyboard protocol (`CSI > 1 u`) so `Shift+Enter`, `Ctrl+Shift+A`, etc. are unambiguous. Pops the stack on unmount.                                               |
| `useAgentLoop`             | `hooks/useAgentLoop.ts`                     | Bridges `IAgentLoop` into React with 200ms streaming batch + AbortController-based interrupt-and-redirect.                                                                                   |
| `useFpsTracker`            | `hooks/useFpsTracker.ts`                    | Render-time FPS measurement for the optional overlay.                                                                                                                                        |
| `useFlickerDetector`       | `hooks/useFlickerDetector.ts` (T-060)       | Watches the root DOM node for visual flicker; logs to debug overlay.                                                                                                                         |
| `useLoadingIndicator`      | `hooks/useLoadingIndicator.ts`              | Drives the elapsed-time + cancel hint for the busy state.                                                                                                                                    |
| `useIsScreenReaderEnabled` | `hooks/useIsScreenReaderEnabled.ts` (T-033) | Auto-detects screen-reader mode from `GOLI_CLI_ACCESSIBILITY` / `NO_COLOR` / `--accessibility`.                                                                                              |
| `useSpinIndex`             | `hooks/useSpinIndex.ts`                     | 100ms-tick spinner index for `AgentStateBar`.                                                                                                                                                |
| `useInactivityTimer`       | `hooks/useInactivityTimer.ts`               | Fires callbacks after configurable idle timeout (used by `ShortcutsHelp`).                                                                                                                   |
| `useShellInactivityStatus` | `hooks/useShellInactivityStatus.ts`         | Tracks long-running background shells; surfaces inactivity warnings.                                                                                                                         |
| `useTurnActivityMonitor`   | `hooks/useTurnActivityMonitor.ts`           | Watches for stalled turns (no events for N seconds).                                                                                                                                         |

## New lib modules

| Module                    | Module path                              | Purpose                                                                                                                                                                     |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fileCompletion`          | `lib/fileCompletion.ts` (T-082)          | `@`-prefix Tab completion: scans the partial path, returns up to 20 `FileCompletion` candidates (dirs + files).                                                             |
| `shellCompletion`         | `lib/shellCompletion.ts` (T-092)         | `!`-prefix Tab completion: git/npm subcommand tables + `$PATH` binary scan.                                                                                                 |
| `editor`                  | `lib/editor.ts` (T-080)                  | Opens `$EDITOR` / `$VISUAL` / `vi` (or `notepad` on Windows) on a temp file with the current prompt; returns the edited text. Used by `Ctrl+O`.                             |
| `unicode`                 | `lib/unicode.ts` (T-090)                 | Code-point-based `toCodePoints` / `cpLen` / `cpSlice` so the cursor moves correctly through emoji, CJK, and combining marks.                                                |
| `expandedTools`           | `lib/expandedTools.ts` (T-091)           | Global registry of expanded tool-call IDs + subscription mechanism. `/expand` and `Ctrl+O` toggle entries; `AgentMessage` re-renders on change.                             |
| `tips`                    | `lib/tips.ts` (T-101)                    | Curated list of tips across categories (shortcut, command, feature, productivity). `/tips` cycles through them.                                                             |
| `backgroundShellRegistry` | `lib/backgroundShellRegistry.ts` (T-098) | Tracks background shells (id, command, startedAt, running, exitCode) for the `/bg` command and future panel. Populated via callbacks from `tools/core/background-shell.ts`. |
| `batchedScroll`           | `lib/batchedScroll.ts`                   | Coalesces same-tick `scrollIntoView()` calls into a single microtask flush.                                                                                                 |
| `InputHistory`            | `lib/InputHistory.ts`                    | Persists submitted prompts to `~/.goli/history`; ↑/↓ navigation; capped at 100 entries.                                                                                     |
| `vimMode`                 | `lib/vimMode.ts`                         | Pure state machine (`vimHandleKey`) for INSERT/NORMAL/VISUAL modes.                                                                                                         |
| `keymap`                  | `lib/keymap.ts`                          | Resolves keybindings (configurable via `~/.goli/keymap.json` in future).                                                                                                    |
| `capabilities`            | `lib/capabilities.ts`                    | Detects terminal capabilities (truecolor, 256-color, unicode, sync output, SSH, tmux, a11y). Cached for process lifetime.                                                   |
| `CommandRegistry`         | `lib/CommandRegistry.ts`                 | Global registry of slash commands with `kind` (`builtin`/`MCP`/`Agent`/`custom`) and `sectionTitle` for grouping.                                                           |
| `CommandService`          | `lib/CommandService.ts` (T-061)          | Dispatches slash commands; resolves aliases and permission gating.                                                                                                          |
| `customCommands`          | `lib/customCommands.ts` (T-041)          | Loads user-defined slash commands from `~/.goli/commands/*.md`.                                                                                                             |

## Slash-command autocomplete

`PromptInput` integrates `SuggestionsDisplay` for slash-command
autocomplete:

1. Typing `/` shows ALL commands.
2. Typing `/he` filters to commands whose name starts with `he` (e.g. `help`).
3. ↑/↓ navigate the active suggestion.
4. Enter dispatches the active suggestion directly.
5. Tab accepts the active suggestion as a prefix (`/help `).
6. Esc dismisses the suggestion list.

Commands can declare a `kind` field (`builtin`, `MCP`, `Agent`,
`custom`) which renders as a suffix (`[MCP]`, `[Agent]`). Commands can
also declare a `sectionTitle` for grouping under `-- Section --`
headers.

## Input history

`InputHistory` (`packages/cli/src/tui/lib/InputHistory.ts`) persists
submitted prompts to `~/.goli/history`. Up arrow navigates to previous
prompts; Down arrow navigates forward. History is capped at 100
entries. `Ctrl+R` activates reverse-search mode for fuzzy filtering
through history; pressing `Ctrl+R` again advances to the next older
match.

## Vim mode

`vimMode.ts` (`packages/cli/src/tui/lib/vimMode.ts`) implements a pure
state machine for vim-style editing:

- **INSERT mode** (default): normal typing.
- **NORMAL mode** (Esc): `h`/`j`/`k`/`l` navigation, `i`/`a`/`A`/`I`/`o`/`O` to insert, `x`/`dd` to delete, `v` for visual.
- **VISUAL mode** (`v`): selection with motion, `x`/`d` to delete.

`vimHandleKey(state, key, textLines)` is a pure function returning
`{ state, action }`. The action tells `PromptInput` what to do
(insert, delete, submit, etc.). Toggle the whole mode with `/vim`.

## File and shell completion

Two prefix characters unlock inline tab-completion in `PromptInput`:

- **`@`** — file-path completion via `lib/fileCompletion.ts`. Type
  `@src/` + Tab to list files/dirs under `src/`; selecting one inserts
  the relative path. Capped at 20 candidates to avoid flooding the TUI.
- **`!`** — shell-command completion via `lib/shellCompletion.ts`. Type
  `!git ` + Tab for git subcommands (`add`, `commit`, `push`, …) or
  `!npm ` + Tab for npm subcommands. Falls back to scanning `$PATH`
  for unknown commands.

## `$EDITOR` integration

`Ctrl+O` opens `$EDITOR` (or `$VISUAL`, or `vi` / `notepad` as
fallback) on a temp file pre-filled with the current prompt text. When
the editor exits, the edited text is loaded back into the prompt and a
system message confirms the swap. If a paste is currently compacted,
`Ctrl+O` toggles the paste's expansion instead (T-089).

## Toast notifications

`ToastDisplay` (`packages/cli/src/tui/components/ToastDisplay.tsx`)
shows transient UI feedback:

- **Ctrl+C twice**: "Press Ctrl+C again to exit."
- **Esc twice**: "Press Esc again to clear prompt." (or "to rewind" if prompt is empty)
- **Transient messages**: caller-supplied text + severity (warning/hint/error).

Priority: Ctrl+C > Ctrl+D > error > escape > toast.

## Theme system

### `tokens.ts` — mutable Tokyo Night Dark palette

The default color palette is defined in
`packages/cli/src/tui/theme/tokens.ts`. The exported `T` object is
**mutable** — `applySkinToTokens()` writes new hex values into `T.red`,
`T.blue`, etc. in place so every component that reads `T.red` on
render picks up the new color. The active border style is held in a
parallel mutable `B.borderStyle` token.

### `skin-engine.ts` — 20 built-in skins + user YAML

The skin engine (`packages/cli/src/tui/theme/skin-engine.ts`) provides
20 built-in skins plus user-defined YAML skins in
`~/.goli/skins/<name>.yaml`. Active skin resolution:
`--skin` CLI flag → `GOLI_SKIN` env var → `NO_COLOR` env var →
`default`. See [Themes](../cli/themes.md) for the full list.

### Live theme switching

`/theme <name>` calls `loadSkin(name)` then
`applySkinToTokens(skin)`, which:

1. Writes the new colors into `T`.
2. Writes the new border style into `B.borderStyle`.
3. Increments `themeVersionCounter` and notifies subscribers.
4. `useThemeVersion()` in `App` triggers a re-render, propagating the
   new `T` / `B` values down the tree.

No restart, no flicker. See [Themes → Live hot-reload](../cli/themes.md#live-hot-reload-no-restart-needed).

### Color downsampling

`resolveColor(hex)` in `tokens.ts` downsamples truecolor hex to the
terminal's native palette (256-color or 16-color) for terminals that
lack truecolor support. Capability is detected once at startup via
`detectCapabilities()` and cached for the process lifetime. See
[Themes → Color downsampling](../cli/themes.md#color-downsampling-resolvecolor).

## Accessibility

### Screen-reader mode

`ScreenReaderAppLayout` provides a linear, decoration-free layout for
screen-reader users. Auto-detected via `useIsScreenReaderEnabled()`,
which checks `--accessibility` / `--screen-reader` flags,
`GOLI_CLI_ACCESSIBILITY=1`, and `NO_COLOR=1`.

### WCAG AA compliance

All 20 built-in themes pass WCAG 2.1 AA for foreground text (≥4.5:1
contrast on the intended background). The `high-contrast` theme
passes AAA (≥7:1). See `docs/a11y-report.md` for the full audit.

### Text-based icons

All status indicators use text characters
(`● ○ ◷ ✓ ✗ ⊘ ℹ ⚠ 💡 💭`) rather than emoji or images, ensuring
screen-reader compatibility.

## Keyboard shortcuts

| Key           | Action                                                             |
| ------------- | ------------------------------------------------------------------ |
| `?`           | Toggle help panel                                                  |
| `Esc`         | Close help / abort when busy / Esc-twice to clear                  |
| `Ctrl+C`      | Abort when busy / Ctrl+C-twice to exit                             |
| `Ctrl+D`      | Exit (when idle and no messages)                                   |
| `Ctrl+G`      | Toggle god mode                                                    |
| `Ctrl+P`      | Show command palette                                               |
| `Ctrl+R`      | Reverse-search through prompt history                              |
| `Ctrl+O`      | Open `$EDITOR` (or toggle compact-paste expansion)                 |
| `Ctrl+S`      | Toggle mouse-scroll mode                                           |
| `Ctrl+L`      | Clear the screen                                                   |
| `Ctrl+\`      | Toggle design (splash ↔ compact header)                            |
| `Ctrl+Z`      | Suspend to background (Unix only)                                  |
| `Shift+Tab`   | Cycle permission mode (SAFE → GOD → PLAN)                          |
| `Up/Down`     | History navigation (or suggestion navigation when `/` is active)   |
| `Tab`         | Accept active suggestion (when `/` is active) or queue (when busy) |
| `Enter`       | Submit (or dispatch active suggestion)                             |
| `Shift+Enter` | Insert newline (multi-line input)                                  |
| `Ctrl+J`      | Insert newline (alternative)                                       |
| `Ctrl+K`      | Fast-approve the current permission request                        |

## See also

- [Getting Started](../getting-started.md) — install + first run.
- [Themes](../cli/themes.md) — 20 built-in themes + custom YAML skins +
  live hot-reload + color downsampling.
- [API Reference](../api/README.md)
- [Architecture Decisions](../decisions/) — 46 ADRs.
- [A11y Report](../a11y-report.md)
