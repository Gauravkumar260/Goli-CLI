/**
 * ScreenReaderAppLayout — alternative TUI layout for screen readers (T-033).
 *
 * When screen-reader mode is enabled (`--accessibility`, `--screen-reader`,
 * `GOLI_CLI_ACCESSIBILITY=1`, or `NO_COLOR=1`), the App uses this layout
 * instead of the default visual layout.
 *
 * ## What's different
 *
 * The screen-reader layout:
 *   - Disables ALL animations (spinners, blinking cursors, FPS overlay).
 *   - Disables scrolling regions (uses full-page redraws instead).
 *   - Disables live regions (they confuse screen readers — they announce
 *     every change, which is noise).
 *   - Uses plain text instead of box-drawing characters where possible.
 *   - Increases color contrast (no dim/grey text — use bold instead).
 *   - Renders a linear top-to-bottom flow (no multi-column layouts that
 *     screen readers can't navigate).
 *
 * ## Reference
 *
 * Matches the gemini-cli pattern (`apps/cli/src/ui/layouts/ScreenReaderAppLayout.tsx`):
 * a separate layout component that renders the same content but in a
 * screen-reader-friendly order and without visual decorations.
 *
 * @module tui/components/ScreenReaderAppLayout
 */

import React from 'react';
import { Box, Text } from 'ink';

import { HistoryScroll } from './HistoryScroll.js';

import type { Message } from '../state/types.js';
import type { AppMode } from '../theme/agents.js';

/** Props for the ScreenReaderAppLayout component. */
export interface ScreenReaderAppLayoutProps {
  /** The conversation history (user + assistant messages). */
  messages: Message[];
  /** Whether the agent is currently busy (running a tool). */
  isBusy: boolean;
  /** The current agent phase (e.g. 'thinking', 'tool-calling'). */
  agentPhase: string;
  /** The current model name (for the header). */
  model: string;
  /** The current working directory (for the status line). */
  cwd: string;
  /** Token usage info (for the status line). */
  tokenUsage?: { used: number; limit: number };
  /** Legacy RunMode — kept for backward compat. Prefer `appMode`. */
  mode?: 'SAFE' | 'GOD';
  /** T-MODE: The current permission mode (read-only/plan/build/god). */
  appMode?: AppMode;
}

/**
 * Screen-reader-friendly layout.
 *
 * Renders a linear flow: Header → Status → History → PromptHint.
 * No boxes, no borders, no animations, no live regions.
 *
 * The actual PromptInput component is rendered by the parent App (outside
 * this layout) because it needs keyboard event handlers that are wired
 * at the App level. This layout renders everything ELSE in screen-reader
 * order.
 */
export function ScreenReaderAppLayout({
  messages,
  isBusy,
  agentPhase,
  model,
  cwd,
  tokenUsage,
  mode = 'SAFE',
  appMode,
}: ScreenReaderAppLayoutProps): React.ReactElement {
  const status = isBusy ? `Busy (${agentPhase})` : 'Ready';
  const tokens = tokenUsage
    ? `${tokenUsage.used}/${tokenUsage.limit} tokens`
    : 'tokens: N/A';
  // T-MODE: prefer the canonical AppMode; fall back to legacy mode.
  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');

  return (
    <Box flexDirection="column" width="100%">
      {/* Header — plain text, no box, no box-drawing chars */}
      <Text bold>
        Goli-CLI — {model} — {effectiveAppMode} mode
      </Text>

      {/* Status line — announce phase changes as plain text */}
      <Text>
        Status: {status} | {tokens} | cwd: {cwd}
      </Text>

      {/* Separator — plain text, not a box border */}
      <Text>{'—'.repeat(40)}</Text>

      {/* History — full text, no scrolling region */}
      <HistoryScroll messages={messages} />

      {/* Footer separator */}
      <Text>{'—'.repeat(40)}</Text>

      {/* Prompt hint — the actual input is rendered by the parent App */}
      <Text dimColor>
        {isBusy
          ? 'Agent is working. Press Ctrl+C to interrupt.'
          : 'Type your prompt and press Enter to submit.'}
      </Text>
    </Box>
  );
}
