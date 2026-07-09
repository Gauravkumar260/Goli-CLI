/**
 * components/QueuedMessagesTray.tsx — Queued messages tray (T-095).
 *
 * Reference: gemini-cli's `QueuedMessageDisplay.tsx` shows queued
 * (Tab-queued) messages as a preview above the input. Goli-CLI showed
 * only a count ("N queued") in the busy-input indicator.
 *
 * This component renders a bordered tray showing the queued messages
 * with their text (truncated) and age, so the user can see what's
 * queued before the next turn.
 *
 * Layout:
 *   ┌─ Queued (2) ──────────────────────────────────────┐
 *   │ 1. fix the bug in auth.ts                   5s ago │
 *   │ 2. add tests for the new module             2s ago │
 *   └────────────────────────────────────────────────────┘
 *
 * @module tui/components/QueuedMessagesTray
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import type { QueuedMessage } from '../state/types.js';

interface Props {
  /** The queued messages to display. */
  messages: readonly QueuedMessage[];
  /** Terminal width. */
  cols: number;
  /** Maximum number of messages to show (default: 5). */
  maxShow?: number;
}

/**
 * Format a timestamp as "Ns ago" or "Nm ago".
 */
function formatAge(timestamp: number): string {
  const sec = Math.round((Date.now() - timestamp) / 1000);
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

/**
 * Truncate text to maxLen characters, appending ellipsis if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Queued messages tray. Shows up to `maxShow` messages with their
 * text (truncated to fit) and age. If there are more than `maxShow`
 * messages, shows "+N more" at the bottom.
 */
export function QueuedMessagesTray({
  messages,
  cols,
  maxShow = 5,
}: Props): React.ReactElement | null {
  if (messages.length === 0) return null;

  const innerW = Math.min(cols - 4, 70);
  const visible = messages.slice(0, maxShow);
  const hidden = messages.length - visible.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={T.teal}
      paddingX={1}
      marginY={0}
      width={cols}
    >
      <Box width={innerW}>
        <Text color={T.teal} bold>Queued ({messages.length})</Text>
        <Text color={T.gray} dimColor> — Tab to queue, /queue clear to remove</Text>
      </Box>
      {visible.map((msg, i) => {
        // Reserve: index (3) + age (10) + padding (4) = ~17 chars.
        const maxTextLen = Math.max(10, innerW - 20);
        return (
          <Box key={i} width={innerW} flexDirection="row">
            <Text color={T.gray}>{i + 1}. </Text>
            <Text color={T.fg} wrap="truncate-end">
              {truncate(msg.text, maxTextLen)}
            </Text>
            <Box flexGrow={1} />
            <Text color={T.gray} dimColor>{formatAge(msg.timestamp)}</Text>
          </Box>
        );
      })}
      {hidden > 0 && (
        <Box width={innerW}>
          <Text color={T.gray} dimColor>+{hidden} more</Text>
        </Box>
      )}
    </Box>
  );
}
