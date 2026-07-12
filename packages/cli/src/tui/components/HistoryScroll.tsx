import React from 'react';
import { Box } from 'ink';
import { MessageBubble } from './MessageBubble.js';
import type { Message } from '../state/types.js';

interface Props {
  messages: Message[];
}

function HistoryScrollImpl({ messages }: Props): React.ReactElement | null {
  if (messages.length === 0) return null;

  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </Box>
  );
}

export const HistoryScroll = React.memo(HistoryScrollImpl);