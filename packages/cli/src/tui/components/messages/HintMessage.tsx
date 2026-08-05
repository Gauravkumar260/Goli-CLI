/**
 * components/messages/HintMessage.tsx — Hint / tip message renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's HintMessage.tsx pattern.
 * T-088 (loop run 6): enhanced with hint categories (tip/suggestion/shortcut),
 * each with its own accent color and label. Inspired by Hermes' 485-line
 * tip corpus (hermes_cli/tips.py).
 *
 * Layout (icon is ALWAYS 💡 per T-045 contract; the kind only affects
 * the bracketed label and accent color):
 *   💡 [tip] <hint content>
 *   💡 [shortcut] <hint content>
 *   💡 [suggestion] <hint content>
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

/** Hint kind — affects the label and accent color (icon stays 💡 per T-045). */
type HintKind = 'tip' | 'suggestion' | 'shortcut';

function inferKind(content: string): HintKind {
  const lower = content.toLowerCase();
  // Shortcuts mention keys or key combos.
  if (/\b(ctrl|cmd|alt|shift|esc|tab|enter|⌘|⌃|⌥|⇧)\b/i.test(content) || /\bpress\b/i.test(content)) {
    return 'shortcut';
  }
  // Suggestions use phrases like "you could", "try", "consider".
  if (/\b(you could|consider|might want|try using)\b/i.test(content)) {
    return 'suggestion';
  }
  return 'tip';
}

/** The hint icon is always 💡 — the T-045 contract requires every hint
 *  message to render the lightbulb. The kind only affects the label
 *  and accent color, not the icon. */
const HINT_ICON = '💡';

function kindColor(kind: HintKind): string {
  switch (kind) {
    case 'shortcut': return T.purple;
    case 'suggestion': return T.yellow;
    case 'tip': default: return T.teal;
  }
}

function kindLabel(kind: HintKind): string {
  switch (kind) {
    case 'shortcut': return 'shortcut';
    case 'suggestion': return 'suggestion';
    case 'tip': default: return 'tip';
  }
}

/**
 * Render a hint message. Icon is always 💡; color and label depend on
 * the inferred kind.
 */
export function HintMessage({ message }: Props): React.ReactElement {
  if (message.type !== 'hint') {
    return <Text color={T.red}>[HintMessage: non-hint message]</Text>;
  }
  const kind = inferKind(message.content);
  const color = kindColor(kind);
  const label = kindLabel(kind);

  return (
    <Box marginY={0} paddingLeft={1}>
      <Text>
        <Text color={color}>{HINT_ICON}</Text>
        {' '}
        <Text color={color} dimColor>[{label}]</Text>
        {' '}
        <Text color={T.fg}>{message.content}</Text>
      </Text>
    </Box>
  );
}
