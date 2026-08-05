/**
 * components/messages/ErrorMessage.tsx — Error message renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's ErrorMessage.tsx pattern.
 *
 * Layout:
 *   ✗ Error: <error content>
 *   [code: ERROR_CODE]   (only if code is provided)
 *
 * Error messages are emitted when tools fail, the agent loop crashes,
 * or external services return errors. They use T.red and the ✗ icon
 * for maximum visibility.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/**
 * Render an error message. Red color + ✗ icon + optional error code.
 */
export function ErrorMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'error') {
    return <Text color={T.red}>[ErrorMessage: non-error message]</Text>;
  }
  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1}>
      <Box>
        <Text color={T.red}>✗ Error: {message.content}</Text>
      </Box>
      {message.code && (
        <Box paddingLeft={2}>
          <Text color={T.gray} dimColor>[code: {message.code}]</Text>
        </Box>
      )}
    </Box>
  );
}
