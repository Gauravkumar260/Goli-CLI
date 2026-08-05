/**
 * components/messages/WarningMessage.tsx — Warning message renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's WarningMessage.tsx pattern.
 * T-088 (loop run 6): enhanced with severity levels (deprecated/limit/
 * rate-limit/config), each with its own label. Inspired by Hermes'
 * structured warning system.
 *
 * Layout:
 *   ⚠ <warning content>
 *
 * Or with kind:
 *   ⚠ [rate-limit] <warning content>
 *   ⚠ [deprecated] <warning content>
 *   ⚠ [config] <warning content>
 *
 * Warning messages are emitted for non-fatal issues: deprecated APIs,
 * approaching rate limits, ambiguous input, config drift. Yellow color
 * + ⚠ icon.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
}

/** Warning kind — affects the label and severity color. */
type WarningKind = 'deprecated' | 'limit' | 'rate-limit' | 'config' | 'generic';

function inferKind(content: string): WarningKind {
  const lower = content.toLowerCase();
  if (/\b(deprecat(ed|ion)|legacy|removed in|will be removed)\b/i.test(content)) {
    return 'deprecated';
  }
  if (/\b(rate.?limit|429|too many requests|quota exceeded)\b/i.test(content)) {
    return 'rate-limit';
  }
  if (/\b(approaching|exceeds?|over (the )?limit|budget|context (window|length))\b/i.test(content)) {
    return 'limit';
  }
  if (/\b(config|setting|misconfigured|invalid option)\b/i.test(content)) {
    return 'config';
  }
  return 'generic';
}

function kindLabel(kind: WarningKind): string {
  switch (kind) {
    case 'deprecated': return 'deprecated';
    case 'rate-limit': return 'rate-limit';
    case 'limit': return 'limit';
    case 'config': return 'config';
    case 'generic': default: return 'warning';
  }
}

function kindColor(kind: WarningKind): string {
  switch (kind) {
    case 'deprecated': return T.purple;  // deprecation is informational
    case 'rate-limit': return T.red;     // rate limits are urgent
    case 'limit': return T.orange;       // limits are warning
    case 'config': return T.blue;        // config is informational
    case 'generic': default: return T.yellow;
  }
}

/**
 * Render a warning message. Color depends on the inferred kind.
 */
export function WarningMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'warning') {
    return <Text color={T.red}>[WarningMessage: non-warning message]</Text>;
  }
  const kind = inferKind(message.content);
  const color = kindColor(kind);
  const label = kindLabel(kind);

  return (
    <Box marginY={0} paddingLeft={1}>
      <Text>
        <Text color={color}>⚠</Text>
        {' '}
        <Text color={color} dimColor>[{label}]</Text>
        {' '}
        <Text color={T.fg}>{message.content}</Text>
      </Text>
    </Box>
  );
}
