/**
 * components/messages/WarningMessage.tsx — Warning message renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's WarningMessage.tsx pattern.
 *
 * Layout:
 *   ⚠ <warning content>
 *
 * Warning messages are emitted for non-fatal issues: deprecated APIs,
 * approaching rate limits, ambiguous input. Yellow color + ⚠ icon.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/**
 * Render a warning message. Yellow color + ⚠ icon.
 */
export function WarningMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'warning') {
    return <Text color={T.red}>[WarningMessage: non-warning message]</Text>;
  }
  return (
    <Box marginY={0} paddingLeft={1}>
      <Text color={T.yellow}>⚠ {message.content}</Text>
    </Box>
  );
}
