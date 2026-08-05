/**
 * components/HistoryScroll.tsx — Transcript renderer using Ink's <Static>.
 *
 * T-090 (refinement): Previously rendered ALL messages in a regular <Box>,
 * which caused severe lag during streaming — every incoming token
 * re-rendered the entire transcript (50+ messages). Now uses Ink's
 * <Static> component for completed messages, which writes them to stdout
 * once and never re-renders them. Only the in-flight (streaming) message
 * renders in the regular flow.
 *
 * <Static> is Ink's built-in solution for chat-like UIs. Items passed to
 * it are rendered exactly once, then "frozen" — Ink writes them to the
 * terminal scrollback and they don't participate in future re-renders.
 * This is critical for performance: a 100-message transcript with
 * streaming tokens would otherwise re-render 100 components on every
 * token, causing multi-second lag.
 *
 * The split logic:
 *   - Messages where `streaming === true` → regular flow (re-renders on tokens)
 *   - All other messages → <Static> (rendered once, frozen)
 *
 * Only agent messages can be streaming. User/system/thinking/etc. messages
 * are always complete when added to the transcript.
 *
 * P1-15 fix: `<Static>` expects an APPEND-ONLY list — items must never be
 * removed or reordered, and the array reference should be stable across
 * re-renders as long as no new items are appended. The previous
 * implementation rebuilt `completedMessages` from scratch on every render
 * via a `for` loop, producing a fresh array reference each time. Ink's
 * `<Static>` then treated this as "all new items" and re-rendered
 * everything, defeating the freeze optimization. Worse, when a streaming
 * message completed (streaming: true → false), it MOVED from
 * `streamingMessages` to `completedMessages` — `<Static>` had already
 * rendered it (or not, depending on timing), so the user might see it
 * twice or see the whole transcript flash.
 *
 * The fix uses a ref-based incremental accumulator:
 *   - `completedRef.current` is a stable array that we only APPEND to.
 *   - On each render, we walk `messages` and append any new completed
 *     messages to `completedRef.current`. We never remove or reorder.
 *   - When a previously-streaming message completes, we append its
 *     FINAL (non-streaming) form to `completedRef.current`. The
 *     streaming version is removed from the dynamic list.
 *   - /clear resets both `completedRef.current` and the streaming list.
 *
 * The array identity of `completedRef.current` only changes when items
 * are actually appended, which is exactly what `<Static>` needs.
 */
import React from 'react';
import { Box, Static } from 'ink';
import { MessageBubble } from './MessageBubble.js';
import type { Message } from '../state/types.js';

interface Props {
  messages: Message[];
}

/**
 * Pure partitioning helper — splits a message list into "completed" and
 * "streaming" buckets. Only `agent` messages with `streaming === true`
 * are considered in-flight; everything else (including non-agent
 * messages that incorrectly have `streaming: true`) is treated as
 * completed. The completed list preserves chronological order and is
 * monotonic (appending a message never changes the prefix already
 * returned).
 *
 * Extracted as a pure function so it can be unit-tested independently
 * of the React component (see `tests/unit/history-scroll.test.ts`).
 */
export function partitionMessages(
  messages: readonly Message[],
): { completed: Message[]; streaming: Message[] } {
  const completed: Message[] = [];
  const streaming: Message[] = [];
  for (const msg of messages) {
    const isStreaming = msg.type === 'agent' && msg.streaming === true;
    if (isStreaming) {
      streaming.push(msg);
    } else {
      completed.push(msg);
    }
  }
  return { completed, streaming };
}

function HistoryScrollImpl({ messages }: Props): React.ReactElement | null {
  if (messages.length === 0) return null;

  // P1-15 fix: stable ref for completed messages. We track which message
  // IDs we've already promoted to "completed" so we only append NEW
  // completions on each render. The array reference stays stable across
  // renders that don't add completions, so `<Static>` doesn't re-render.
  const completedRef = React.useRef<Message[]>([]);
  const completedIdsRef = React.useRef<Set<string>>(new Set());

  // Detect /clear: if `messages` is shorter than what we've already
  // promoted, the user cleared history. Reset both refs.
  if (messages.length < completedRef.current.length) {
    completedRef.current = [];
    completedIdsRef.current = new Set();
  }

  // Walk messages and promote newly-completed ones to completedRef.
  // Also handle the case where a previously-streaming message has now
  // completed (streaming: true → false) — we add its final form.
  const streamingMessages: Message[] = [];
  for (const msg of messages) {
    const isStreaming = msg.type === 'agent' && msg.streaming;
    if (isStreaming) {
      streamingMessages.push(msg);
      continue;
    }
    // This message is "complete". Promote it to completedRef if we
    // haven't already.
    if (!completedIdsRef.current.has(msg.id)) {
      completedIdsRef.current.add(msg.id);
      completedRef.current = [...completedRef.current, msg];
    } else {
      // We've already promoted this ID. But if the message content has
      // changed (e.g. it was promoted while streaming, then completed),
      // we need to update the stored copy. We do this by replacing the
      // existing entry in-place. This is O(N) but only happens once
      // per message completion, not per token.
      const idx = completedRef.current.findIndex((m) => m.id === msg.id);
      if (idx >= 0 && completedRef.current[idx] !== msg) {
        const next = completedRef.current.slice();
        next[idx] = msg;
        completedRef.current = next;
      }
    }
  }

  // Prune any completed IDs that are no longer in `messages` (e.g. the
  // user deleted a message — rare, but defensive). This keeps the
  // completedRef in sync with the source of truth. We rebuild the Set
  // from the current `messages` array.
  const currentIds = new Set(messages.map((m) => m.id));
  if (completedRef.current.some((m) => !currentIds.has(m.id))) {
    completedRef.current = completedRef.current.filter((m) => currentIds.has(m.id));
    completedIdsRef.current = new Set(completedRef.current.map((m) => m.id));
  }

  return (
    <Box flexDirection="column">
      {/* Completed messages — rendered once via <Static>, never re-rendered. */}
      <Static items={completedRef.current}>
        {(msg) => (
          <MessageBubble key={msg.id} message={msg} />
        )}
      </Static>

      {/* In-flight (streaming) messages — re-render on every token. */}
      {streamingMessages.length > 0 && (
        <Box flexDirection="column">
          {streamingMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 *
 */
export const HistoryScroll = React.memo(HistoryScrollImpl);
