/**
 * components/messages/UserMessage.tsx — User message renderer.
 *
 * T-037 (loop run 4): splits MessageBubble into specialized renderers.
 * UserMessage renders the green avatar + content, mirroring gemini-cli's
 * UserMessage.tsx (84 LOC).
 *
 * Layout:
 *   ● <user content>
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/**
 * Render a user message. The green dot avatar is the visual marker
 * that this content came from the user (vs. agent/system).
 *
 * Performance: uses <Text wrap="wrap"> so long lines wrap naturally
 * without manual line-splitting. This is cheaper than the agent
 * renderer's indexOf-based line splitter because user messages are
 * typically short (median ~50 chars).
 */
export function UserMessage({ message }: Props): React.ReactElement {
  return (
    <Box flexDirection="row" marginY={0}>
      <Text color={T.green}>●</Text>
      <Text> </Text>
      <Text wrap="wrap">{message.content}</Text>
    </Box>
  );
}
