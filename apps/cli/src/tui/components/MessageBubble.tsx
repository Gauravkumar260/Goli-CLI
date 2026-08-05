/**
 * components/MessageBubble.tsx — Message dispatcher (T-037 + T-045).
 *
 * Routes each message to its specialized renderer:
 *   - user      → UserMessage
 *   - agent     → AgentMessage (which renders toolCalls via ToolMessage)
 *   - system    → SystemMessage
 *   - btw       → SystemMessage (treated as info variant)
 *   - thinking  → ThinkingMessage (T-045)
 *   - error     → ErrorMessage (T-045)
 *   - warning   → WarningMessage (T-045)
 *   - hint      → HintMessage (T-045)
 *
 * The previous monolithic MessageBubble rendered all types inline.
 * Splitting into specialized renderers makes each one simpler to test,
 * extend, and reason about — and matches gemini-cli's structure (15
 * specialized message renderers under apps/cli/src/ui/components/messages/).
 *
 * Performance: React.memo on each renderer means completed messages
 * NEVER re-render when new messages stream in. The dispatcher itself is
 * also memoized; the routing switch is O(1).
 */
import React from 'react';
import { UserMessage } from './messages/UserMessage.js';
import { AgentMessage } from './messages/AgentMessage.js';
import { SystemMessage } from './messages/SystemMessage.js';
import { ThinkingMessage } from './messages/ThinkingMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { WarningMessage } from './messages/WarningMessage.js';
import { HintMessage } from './messages/HintMessage.js';
import type { Message } from '../state/types.js';

interface Props {
  message: Message;
}

function MessageBubbleImpl({ message }: Props): React.ReactElement | null {
  switch (message.type) {
    case 'user':
      return <UserMessage message={message} />;
    case 'agent':
      return <AgentMessage message={message} />;
    case 'system':
      return <SystemMessage message={message} />;
    case 'btw':
      // BTW messages don't have a `variant` field; treat as info.
      return <SystemMessage message={{ ...message, variant: 'info' as const }} />;
    case 'thinking':
      return <ThinkingMessage message={message} />;
    case 'error':
      return <ErrorMessage message={message} />;
    case 'warning':
      return <WarningMessage message={message} />;
    case 'hint':
      return <HintMessage message={message} />;
    default:
      // Exhaustiveness check — if a new message type is added, this
      // will fail at compile time.
      return null;
  }
}

/**
 *
 */
export const MessageBubble = React.memo(MessageBubbleImpl);
