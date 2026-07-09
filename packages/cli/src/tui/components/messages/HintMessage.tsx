/**
 * components/messages/HintMessage.tsx — Hint / tip message renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's HintMessage.tsx pattern.
 *
 * Layout:
 *   💡 <hint content>
 *
 * Hint messages are emitted for contextual tips: "Try /compact to free
 * tokens", "Press Tab to queue a follow-up". Teal color + 💡 icon.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/**
 * Render a hint message. Teal color + 💡 icon.
 */
export function HintMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'hint') {
    return <Text color={T.red}>[HintMessage: non-hint message]</Text>;
  }
  return (
    <Box marginY={0} paddingLeft={1}>
      <Text color={T.teal}>💡 {message.content}</Text>
    </Box>
  );
}
