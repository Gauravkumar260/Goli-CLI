/**
 * components/messages/ThinkingMessage.tsx — Agent "thinking" / chain-of-thought renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's ThinkingMessage.tsx pattern.
 *
 * Layout (dim, italic-style):
 *   💭 orchestrator
 *     <thinking content>
 *
 * Thinking messages are emitted by the agent during chain-of-thought
 * reasoning. They are visually subdued (dim color, 💭 prefix) to
 * distinguish them from the final agent response.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import { getAgent } from '../../theme/agents.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/**
 * Render a thinking message. The 💭 prefix + dim color signals that
 * this is intermediate reasoning, not the final answer.
 */
export function ThinkingMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'thinking') {
    return <Text color={T.red}>[ThinkingMessage: non-thinking message]</Text>;
  }
  const agentId = message.agentId ?? 'orchestrator';
  const ag = getAgent(agentId);

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1}>
      <Box>
        <Text color={T.gray} dimColor>💭 {ag?.id ?? agentId} (thinking)</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={T.gray} dimColor wrap="wrap">
          {message.content}
        </Text>
      </Box>
    </Box>
  );
}
