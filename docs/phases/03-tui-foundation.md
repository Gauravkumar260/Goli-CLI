# Phase 3 — CLI Shell & TUI Foundation

**Status:** Pending
**Modules touched:** TUI (Ink + React port of reference design)
**Compliance gates:** none new

## Goal

Port the Ink + React TUI reference design. End of Phase 3: `goli`
launches a real terminal UI with splash, header, history scroll,
prompt input, status bar, help panel, FPS overlay, and crash recovery —
all driven by a `MockAgentLoop` for offline UI development. The real
`CliAgentLoop` (Phase 2's `AgentLoop`) plugs in as the production
backend.

## Definition of Done

- [ ] Theme: `src/tui/theme/tokens.ts` (color palette), `src/tui/theme/agents.ts` (AGENTS, SKILLS, TIERS, ART, SPIN, DEMOS)
- [ ] State: `src/tui/state/AppStateStore.ts` (singleton observable), `useAppState.ts` (React hook), `types.ts`, `spinTicker.ts` (10fps singleton)
- [ ] Lib (12 files): `capabilities.ts`, `syncOutput.ts`, `sessionState.ts`, `parentLog.ts`, `memoryMonitor.ts`, `gracefulExit.ts`, `keymap.ts`, `CommandRegistry.ts`, `fpsStore.ts`, `formatUrl.ts`, `supportsHyperlinks.ts`, `circularBuffer.ts`, `terminalModes.ts`
- [ ] Hooks (4 files): `useAgentLoop.ts`, `useFpsTracker.ts`, `useSpinIndex.ts`, `useSecsTick.ts`
- [ ] Components (13 files): `SplashBox`, `HeaderBar`, `AgentStateBar`, `WelcomeTip`, `HistoryScroll`, `MessageBubble`, `PipelineTrace`, `PromptInput`, `PermissionDialog`, `HelpPanel`, `TokenBar`, `StatusBar`, `FpsOverlay`
- [ ] Config: `src/tui/config/limits.ts`
- [ ] Entry: `src/tui/cli.tsx`, `App.tsx`, `args.ts`
- [ ] Services: `IAgentLoop.ts`, `MockAgentLoop.ts` (canned responses)
- [ ] External deps added: `ink`, `react`, `supports-hyperlinks`
- [ ] `goli` (no args) launches the TUI; `MockAgentLoop` responds to prompts
- [ ] Crash recovery flow (`--recover`, `--clear-crash`)
- [ ] ADR-0012 (Ink + React as TUI framework)

## Steps (P3.x)

3.1 Add `ink`, `react`, `supports-hyperlinks` to `package.json`
3.2 Write `src/tui/theme/tokens.ts` (T palette: border, teal, blue, purple, green, yellow, orange, red, gray, fg)
3.3 Write `src/tui/theme/agents.ts` (AGENTS array with id+color, SKILLS, TIERS, ART, SPIN, DEMOS, getAgent, getTierColor, getTierDesc, TierId)
3.4 Write `src/tui/state/types.ts` (Message, AgentPhase, PendingPermission, ToolCall)
3.5 Write `src/tui/state/spinTicker.ts` (subscribeSpin, getCurrentSpinIndex, 10fps)
3.6 Write `src/tui/state/AppStateStore.ts` (singleton, patch/subscribe/getSnapshot, all the methods)
3.7 Write `src/tui/state/useAppState.ts` (React hook)
3.8 Write `src/tui/lib/capabilities.ts` (terminal detection)
3.9 Write `src/tui/lib/syncOutput.ts` (DEC Synchronized Output patching of process.stdout)
3.10 Write `src/tui/lib/sessionState.ts` (crash snapshot to ~/.goli-cli/crash.json)
3.11 Write `src/tui/lib/parentLog.ts` (lifecycle breadcrumbs)
3.12 Write `src/tui/lib/memoryMonitor.ts` (V8 heap watchdog)
3.13 Write `src/tui/lib/gracefulExit.ts` (signal + crash handler)
3.14 Write `src/tui/lib/keymap.ts` (centralized keybindings + JSON overrides)
3.15 Write `src/tui/lib/CommandRegistry.ts` (slash-command dispatch)
3.16 Write `src/tui/lib/fpsStore.ts` (subscriber FPS tracker)
3.17 Write `src/tui/lib/formatUrl.ts` + `src/tui/lib/supportsHyperlinks.ts` (OSC-8 clickable URLs)
3.18 Write `src/tui/lib/circularBuffer.ts` (generic ring buffer)
3.19 Write `src/tui/lib/terminalModes.ts` (DEC mode reset on exit)
3.20 Write `src/tui/config/limits.ts` (LIVE_RENDER_MAX_CHARS=16000, MAX_HISTORY=600, etc.)
3.21 Write `src/tui/hooks/useSpinIndex.ts`, `useSecsTick.ts` (subscribe to spinTicker)
3.22 Write `src/tui/hooks/useFpsTracker.ts` (per-frame render-time sampler)
3.23 Write `src/tui/services/IAgentLoop.ts` (interface)
3.24 Write `src/tui/services/MockAgentLoop.ts` (canned responses from DEMOS)
3.25 Write 13 components (SplashBox → FpsOverlay)
3.26 Write `src/tui/App.tsx` (root Ink component, useInput handler)
3.27 Write `src/tui/args.ts` + `src/tui/cli.tsx` (entry, hardening, render)
3.28 Wire `src/cli/main.ts` to launch TUI when no `--no-tui` flag
3.29 Write ADR-0012 (Ink + React as TUI framework)
3.30 Manual smoke test: launch `goli`, type a prompt, see MockAgentLoop response
3.31 Worklog entry for Phase 3

## Key Engineering Decisions

- **`<Static>` for completed messages.** In `HistoryScroll` — without this,
  long sessions re-render the entire history every frame.
- **`React.memo` on every leaf component.** With custom comparators where
  shape-changing props (cols, tokens) are involved.
- **`setImmediate` batching in `useAgentLoop`.** One React update per
  event-loop tick, not one per token.
- **`queueMicrotask` coalescing.** In `fpsStore` and `PromptInput` so
  subscribers don't thrash React at 60+ Hz.
- **`MAX_HISTORY = 600` slice.** In `useAgentLoop`'s `setMessages` updater.
- **Env vars respected**: `GOLI_TUI_AGENT`, `GOLI_TUI_FPS`, `GOLI_TUI_HYPERLINKS`, `GOLI_TUI_HEAPMON`, `GOLI_TUI_MODE`, `GOLI_TUI_INITIAL_TASK`, `GOLI_CLI_DEBUG`, `GOLI_CLI_ACCESSIBILITY`, `GOLI_HOME`, `GOLI_HEAPDUMP_DIR`, `VITEST`.

## External modules to author (not in reference dir but imported by it)

- `theme/tokens.ts` — `T` color palette
- `theme/agents.ts` — AGENTS, SKILLS, TIERS, ART, SPIN, DEMOS, getAgent, getTierColor, getTierDesc, TierId
- `state/AppStateStore.ts` — singleton observable store
- `state/useAppState.ts` — React hook
- `state/types.ts` — Message, AgentPhase, PendingPermission, ToolCall
- `state/spinTicker.ts` — subscribeSpin, getCurrentSpinIndex
- `services/IAgentLoop.ts` — interface
- `services/MockAgentLoop.ts` — canned-response impl
- `services/CliAgentLoop.ts` — wraps Phase 2's `AgentLoop` (Phase 3 stub; Phase 4 fills)

## Performance Properties to Preserve

- `<Static>` scrollback (long sessions)
- `React.memo` everywhere
- `setImmediate` batching for streaming text
- `queueMicrotask` coalescing for high-frequency updates
- `MAX_HISTORY = 600` slice
