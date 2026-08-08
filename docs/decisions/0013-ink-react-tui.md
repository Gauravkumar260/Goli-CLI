# ADR-0013: Ink + React as TUI Framework

**Status:** Accepted
**Phase:** P3
**Date:** 2026-07-03

> **Note (2026-08-07):** Still current — the TUI remains Ink/React in `apps/cli/src/tui/`. References to `@goli/core`'s `AgentLoop` in this record predate the package split; the agent loop now lives in `@goli-cli/agent-core` (`AgentLoop` in `packages/agent-core/src/loop.ts`), wrapped by `CliAgentLoop` in `apps/cli/src/services/`.

## Context

GOLI-CLI needs a terminal UI framework for the interactive mode
(`goli wakeup --interactive`). The upstream TUI reference design
(33 files) is written in **Ink + React** — the same stack used by
Claude Code, Gemini CLI, and most modern Node.js CLIs.

The alternatives are:

- **raw stdout** (like Aider's original UI) — too much manual cursor
  management, no component model, no diff-based rendering
- **blessed/neo-blessed** — older, callback-based, no React model
- **ratatui (Rust)** — requires a Rust binary; we chose TypeScript
  (ADR-0002)
- **Bubble Tea (Go)** — same language mismatch

## Decision

Use **Ink + React** as the TUI framework, matching the upstream
reference design 1:1.

Rationale:

1. **The reference design is already Ink + React.** Porting to another
   framework would require rewriting all 33 files and risk introducing
   visual/behavioral regressions.
2. **React's component model** maps perfectly to a TUI: each visual
   element (splash, header, status bar, prompt) is a component with
   props and state.
3. **`useSyncExternalStore`** (React 18) gives us tear-free reads from
   the AppStateStore singleton — no Redux/Zustand needed.
4. **`<Static>`** (Ink's built-in component) renders completed messages
   once and never touches them again — O(1) per-frame cost regardless
   of history length. This is critical for long sessions.
5. **`React.memo`** on every leaf component prevents re-renders during
   streaming.
6. **Familiar to contributors** — React is the most-known UI framework
   in the JS ecosystem.

## Key Design Patterns

### 1. AppStateStore singleton + useSyncExternalStore

The `AppStateStore` is a plain singleton with `subscribe()` and
`getSnapshot()`. React's `useSyncExternalStore` hook (via
`useAppState()`) subscribes to it. This gives us:

- State accessible from outside React (command handlers, agent loop)
- Tear-free reads
- No external state management library

**Critical**: `getSnapshot()` must return a **cached reference**. If it
returns a new object every call, React's `useSyncExternalStore` will
loop infinitely. The store caches the snapshot and invalidates it on
every `patch()`.

### 2. `<Static>` for completed messages

`HistoryScroll` splits messages into:

- **Completed** → `<Static items={completed}>` (rendered once, natural
  terminal scrollback)
- **Streaming** → live React tree (re-renders on every delta)

Without this, a 1000-message session would re-render the entire history
on every token.

### 3. `setImmediate` batching for streaming

`useAgentLoop` accumulates content deltas in a buffer and flushes via
`setImmediate` — one React update per event-loop tick, not one per
token. This prevents React from thrashing at 60+ Hz during streaming.

### 4. `queueMicrotask` coalescing

`PromptInput` and `fpsStore` use `queueMicrotask` to coalesce high-
frequency events (keystrokes, frame measurements) into single updates.

### 5. DEC Synchronized Output

`syncOutput.ts` patches `process.stdout.write` to wrap every Ink frame
in `CSI ?2026 h <frame> CSI ?2026 l`. The terminal buffers the frame
and renders it atomically — zero flicker. Only enabled on terminals
that advertise support (iTerm, WezTerm, Alacritty, Kitty, etc.).

### 6. Dual agent backends

- `MockAgentLoop`: canned responses for offline UI development
  (`GOLI_TUI_AGENT=mock`)
- `CliAgentLoop`: wraps `@goli/core`'s `AgentLoop` for production

Both implement the `IAgentLoop` interface, so the TUI doesn't care
which backend is active.

## Consequences

**Positive:**

- 1:1 port of the reference design — no visual regressions.
- Familiar React component model.
- Excellent performance via `<Static>`, `React.memo`, `setImmediate`
  batching, and DEC Synchronized Output.
- Easy to develop UI offline with MockAgentLoop.

**Negative:**

- Added `ink` (~100KB) and `react` (~130KB) dependencies.
- React's reconciliation model has a learning curve for contributors
  who haven't used React before.
- `useSyncExternalStore` requires careful cache management (the
  `getSnapshot` must return a cached reference).

## Implementation

- `packages/cli/src/tui/theme/` — tokens.ts (colors), agents.ts (11
  agents, tiers, ASCII art, spinners, demos)
- `packages/cli/src/tui/state/` — AppStateStore.ts, useAppState.ts,
  types.ts, spinTicker.ts
- `packages/cli/src/tui/lib/` — 13 lib modules (capabilities,
  syncOutput, sessionState, parentLog, memoryMonitor, gracefulExit,
  keymap, CommandRegistry, fpsStore, formatUrl, supportsHyperlinks,
  circularBuffer, terminalModes)
- `packages/cli/src/tui/hooks/` — useAgentLoop, useFpsTracker,
  useSpinIndex, useSecsTick
- `packages/cli/src/tui/services/` — IAgentLoop, MockAgentLoop,
  CliAgentLoop
- `packages/cli/src/tui/components/` — 13 components (SplashBox,
  HeaderBar, AgentStateBar, WelcomeTip, HistoryScroll, MessageBubble,
  PipelineTrace, PromptInput, PermissionDialog, HelpPanel, TokenBar,
  StatusBar, FpsOverlay)
- `packages/cli/src/tui/config/limits.ts` — bounded-resource constants
- `packages/cli/src/tui/App.tsx` — root component
- `packages/cli/src/tui/cli.tsx` — entry point (render + hardening)
- `packages/cli/src/tui/args.ts` — TUI arg parser

## References

- Ink: <https://github.com/vadimdemedes/ink> (MIT)
- React 18 useSyncExternalStore: <https://react.dev/reference/react/useSyncExternalStore>
- DEC Synchronized Output: CSI ?2026 h / l (terminal flicker killer)
- Upstream TUI reference design (33 files in `tui for reference design/`)
