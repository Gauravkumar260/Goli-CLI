import React from 'react';
import { Box, Static } from 'ink';
import { MessageBubble } from './MessageBubble.js';
import type { Message } from '../state/types.js';

interface Props {
  messages: Message[];
}

/**
 * Splits `messages` into:
 *  - completed: no longer streaming, chronological order (oldest→newest)
 *  - streaming: agent messages currently streaming (0-N, swarm-safe)
 *
 * Assumption: `messages` is append-only (pushed to the end, never
 * reordered) and `streaming` only transitions true -> false, never back.
 * Both are required for `completed` to grow monotonically — <Static>
 * diffs by array length, not content, so it renders whatever is past the
 * length it saw last render. If the store ever prunes messages, it must
 * only trim from the *front*, and only entries Static has already
 * rendered — trimming the middle or re-adding an old id will duplicate
 * or skip lines on screen.
 */
export function partitionMessages(
  messages: Message[]
): { completed: Message[]; streaming: Message[] } {
  const completed: Message[] = [];
  const streaming: Message[] = [];
  for (const m of messages) {
    if (m.type === 'agent' && m.streaming) streaming.push(m);
    else completed.push(m);
  }
  return { completed, streaming };
}

/**
 * HistoryScroll — renders chat messages above the prompt bar.
 *
 * Chronological order, oldest at top, newest at bottom — how every
 * terminal actually behaves. Completed messages render via <Static>,
 * which prints each one exactly once and never re-touches it: this is
 * what lets a long-running agent session avoid repainting its full
 * history every frame. Currently-streaming messages (a swarm can have
 * several concurrently) render below in a normal reactive Box that
 * re-renders per token.
 */
function HistoryScrollImpl({ messages }: Props): React.ReactElement | null {
  if (messages.length === 0) return null;

  const { completed, streaming } = partitionMessages(messages);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Static items={completed}>
        {(msg) => <MessageBubble key={msg.id} message={msg} />}
      </Static>
      <Box flexDirection="column">
        {streaming.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </Box>
    </Box>
  );
}

export const HistoryScroll = React.memo(HistoryScrollImpl);