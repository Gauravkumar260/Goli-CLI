# CLAUDE.md — `@goli-cli/cli`

> **Audience:** Claude Code working in `apps/cli/`.
> **Parent:** [`/CLAUDE.md`](../../../CLAUDE.md).

## Package purpose

`@goli-cli/cli` is the terminal UI — the Ink v5 + React 19 surface that
users interact with. It also contains the headless runner
(`--headless-output json`) and the Commander subcommands.

The CLI imports `@goli-cli/core` for all agent IP. It owns:

- The TUI component tree (`src/tui/`).
- The Commander program and subcommands (`src/commands/`).
- The CLI-side services that bridge the TUI and `core` (`src/services/`).

## Critical files

| File                              | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `src/index.ts`                    | Entry point. Builds the Commander program.                               |
| `src/tui/App.tsx`                 | Root TUI component. Owns the AppStateStore.                              |
| `src/tui/hooks/useAgentLoop.ts`   | Subscribes to the agent loop's async generator.                          |
| `src/tui/lib/TurnStateMachine.ts` | Per-turn UI state machine (idle → streaming → tool → permission → done). |
| `src/tui/lib/CommandRegistry.ts`  | Unified slash-command registry.                                          |
| `src/tui/theme/skin-engine.ts`    | Theme engine (20 built-in + user YAML).                                  |
| `src/tui/state/AppStateStore.ts`  | Zustand store.                                                           |
| `src/services/CliAgentLoop.ts`    | Bridges the TUI to `@goli-cli/agent-core`'s loop.                                  |
| `src/commands/wakeup.ts`          | The `goli wakeup` subcommand (main TUI entry).                           |
| `src/commands/headless-output.ts` | The `--headless-output` mode.                                            |

## Architecture rules

1. **Components are pure (presentational) or container (own state).**
   No component reads the store directly except through hooks.
2. **`useEffect` deps are exhaustive.** If you must disable
   `react-hooks/exhaustive-deps`, add a comment.
3. **No `useReducer` for everything.** `useState` for simple state,
   `useReducer` for state machines, Zustand for cross-component state.
4. **The slash-command system is unified** — the same registry is used
   by the TUI and the headless runner. A custom command works
   identically in both surfaces.
5. **The TUI is operable with keyboard only.** Every interactive
   element has a keyboard equivalent (ADR: a11y).

## Patterns to follow

- **`useAgentLoop` is the only entry point** to the agent from the TUI.
  Components never call `core`'s loop directly.
- **Ink Testing Library** for component tests
  (`ink-testing-library`).
- **`constrained_layout=True`** in any matplotlib figures (the CLI
  doesn't use matplotlib, but this rule applies if you add it).
- **`boxTo` for legends** outside the plot area (`bbox_to_anchor`), not
  `loc='best'`.

## Common pitfalls

- **Calling `setState` inside `useEffect` body** — wrap in
  `setTimeout(fn, 0)` or use a ref. React Compiler's
  `preserve-manual-memoization` rule will catch this.
- **Direct `activeRunId` usage** in callbacks — use `activeRunIdRef` to
  avoid stale closures.
- **Forgetting `'use client'`** — N/A for the CLI (Ink is always
  client-side), but applies if you copy code to the Studio.
- **Deep imports from `core`** — use the barrel
  (`import { ... } from '@goli-cli/agent-core'`).

## Themes

The TUI ships 25 built-in themes:

- 11 dark themes (including 2 colorblind-friendly).
- 8 light themes (including 2 colorblind-friendly).
- 1 NoColor theme for terminals without color support.

Users can define custom themes in `~/.goli/themes/*.yaml`. See
[`docs/cli/themes.md`](../../../docs/cli/themes.md) for the catalog and
the YAML schema.

## Accessibility

- `--screen-reader` flag enables a flattened layout (no spinners, no
  progress bars, no alt-screen).
- `NO_COLOR` env var switches to the NoColor theme.
- WCAG 2.1 AA contrast ratios enforced by
  `apps/cli/__tests__/a11y-contrast-fixes.test.ts`.
- See [`docs/a11y-report.md`](../../../docs/a11y-report.md) for the full
  audit.

## Tests

- **Component tests:** `*.test.tsx`, using `ink-testing-library`.
- **Hook tests:** `renderHook` from `@testing-library/react`.
- **Coverage:** ≥ 80% lines.
- **A11y tests:** contrast + keyboard-nav + screen-reader-layout.

## See also

- [docs/tui/architecture.md](../../../docs/tui/architecture.md) — TUI
  component tree + state model.
- [docs/cli/themes.md](../../../docs/cli/themes.md) — theme catalog.
- [docs/a11y-report.md](../../../docs/a11y-report.md) — accessibility
  audit.
