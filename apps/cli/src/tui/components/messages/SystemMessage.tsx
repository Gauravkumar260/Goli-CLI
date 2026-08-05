/**
 * components/messages/SystemMessage.tsx — System message renderer.
 *
 * T-037 (loop run 4): splits MessageBubble into specialized renderers.
 * SystemMessage renders the variant-colored (info/warning/error) message
 * with an icon, mirroring gemini-cli's InfoMessage/WarningMessage/
 * ErrorMessage pattern (3 separate files there; we use one parametric
 * renderer for simplicity).
 *
 * Layout:
 *   ℹ <info content>     (teal, ℹ icon)
 *   ⚠ <warning content>  (yellow, ⚠ icon)
 *   ✗ <error content>    (red, ✗ icon)
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

/** The subset of Message that SystemMessage accepts. */
export type SystemMessageVariant = Extract<Message, { type: 'system' | 'btw' }> | {
  id: string;
  type: 'system' | 'btw';
  content: string;
  variant: 'info' | 'warning' | 'error';
  timestamp: number;
};

interface Props {
  message: SystemMessageVariant;
}

/** Pick a color token based on the message variant. */
function colorForVariant(variant: 'info' | 'warning' | 'error'): string {
  switch (variant) {
    case 'error':   return T.red;
    case 'warning': return T.yellow;
    case 'info':
    default:        return T.teal;
  }
}

/** Pick an icon based on the message variant. */
function iconForVariant(variant: 'info' | 'warning' | 'error'): string {
  switch (variant) {
    case 'error':   return '✗';
    case 'warning': return '⚠';
    case 'info':
    default:        return 'ℹ';
  }
}

/**
 * Render a system message. Variant determines color + icon.
 * Variants: info (teal, ℹ), warning (yellow, ⚠), error (red, ✗).
 *
 * For btw messages (which don't have a `variant` field on the Message
 * union), the caller should spread the message and add `variant: 'info'`.
 */
export function SystemMessage({ message }: Props): React.ReactElement {
  // Default to 'info' for btw messages that don't have an explicit variant.
  const variant = ('variant' in message && message.variant) ? message.variant : 'info';
  const color = colorForVariant(variant);
  const icon = iconForVariant(variant);
  return (
    <Box marginY={0}>
      <Text color={color}>{icon} {message.content}</Text>
    </Box>
  );
}
