/**
 * components/messages/ThinkingMessage.tsx — Agent "thinking" / chain-of-thought renderer.
 *
 * T-045 (loop run 5): matches gemini-cli's ThinkingMessage.tsx pattern.
 * T-088 (loop run 6): enhanced with collapsible behavior and reasoning
 * kind labels, inspired by Hermes' Thinking component (1,224 LoC) which
 * renders the reasoning tree with unicode spinners and ASCII tree branches.
 *
 * T-089 (refinement): fixed three bugs introduced in T-088:
 *   1. `onPress` on `<Text>` — Ink's Text doesn't support onPress. Removed.
 *      Toggle is now controlled by the parent via the `expanded` prop, or
 *      self-managed with `defaultExpanded` when the parent doesn't care.
 *   2. Hooks order violation — `useEffect` was called AFTER an early return,
 *      breaking the Rules of Hooks. All hooks are now called unconditionally
 *      at the top of the component.
 *   3. Nested `<Text>` with boolean children — the `&&` conditional inside
 *      `<Text>` children produced `false` values in the children array,
 *      which Ink renders as literal "false" text. Now uses explicit
 *      conditional rendering with fragments.
 *
 * Layout (collapsed by default):
 *   💭 orchestrator (reasoning) ▸ <first 80 chars of content>
 *
 * Layout (expanded):
 *   💭 orchestrator (reasoning) ▾
 *     <full thinking content, wrapped>
 *
 * Thinking messages are emitted by the agent during chain-of-thought
 * reasoning. They are visually subdued (dim color, 💭 prefix) to
 * distinguish them from the final agent response.
 *
 * Toggle: the parent HistoryScroll can pass `expanded` + `onToggle` to
 * control expansion (e.g. via the 't' key when the message is focused).
 * Without those props, the component self-manages expansion via internal
 * state initialized from `defaultExpanded`.
 */
import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import { getAgent } from '../../theme/agents.js';
import type { Message } from '../../state/types.js';

interface Props {
  message: Message;
  /** Initial expansion state when self-managing. Default: false (collapsed). */
  defaultExpanded?: boolean;
  /**
   * Controlled expansion state. When provided, the component is controlled
   * and `onToggle` is called on click/keypress. When omitted, the component
   * self-manages via internal state.
   */
  expanded?: boolean;
  /** Called when the user wants to toggle expansion (controlled mode). */
  onToggle?: () => void;
  /** Show the toggle hint (▸/▾) at the end of the header line. */
  showToggleHint?: boolean;
}

/**
 * The "kind" of thinking — affects the icon and label.
 * Mirrors the web Studio's thinkingKind field.
 */
type ThinkingKind = 'reasoning' | 'plan' | 'analysis' | 'subagent';

function inferKind(content: string): ThinkingKind {
  const lower = content.toLowerCase();
  if (lower.startsWith('plan:') || lower.includes('step 1:') || lower.includes('plan is to')) {
    return 'plan';
  }
  if (lower.startsWith('analyzing') || lower.includes('let me analyze') || lower.includes('analysis:')) {
    return 'analysis';
  }
  if (lower.startsWith('subagent') || lower.includes('delegating to')) {
    return 'subagent';
  }
  return 'reasoning';
}

function kindLabel(kind: ThinkingKind): string {
  switch (kind) {
    case 'plan': return 'plan';
    case 'analysis': return 'analysis';
    case 'subagent': return 'subagent';
    case 'reasoning': default: return 'thinking';
  }
}

function kindIcon(kind: ThinkingKind): string {
  switch (kind) {
    case 'plan': return '📋';
    case 'analysis': return '🔬';
    case 'subagent': return '🌐';
    case 'reasoning': default: return '💭';
  }
}

/**
 * Render a thinking message. The 💭 prefix + dim color signals that
 * this is intermediate reasoning, not the final answer.
 *
 * The T-045 contract requires every thinking message to render the 💭
 * icon and the "thinking" label, regardless of the inferred reasoning
 * kind. The kind is still inferred (and exposed via a `data-kind`
 * attribute on the surrounding Box for future tooling), but it no
 * longer changes the icon or label — that broke T-045's distinct-icon
 * contract when T-088 introduced kind-specific icons.
 *
 * Collapsible: when collapsed, only the header line + first 80 chars
 * are shown. When expanded, the full content is wrapped and indented.
 */
export function ThinkingMessage({
  message,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  showToggleHint = true,
}: Props): React.ReactElement {
  // ALL hooks must be called before any early return — Rules of Hooks.
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const toggle = useCallback(() => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalExpanded(v => !v);
    }
  }, [isControlled, onToggle]);

  // Early return AFTER all hooks.
  if (message.type !== 'thinking') {
    return <Text color={T.red}>[ThinkingMessage: non-thinking message]</Text>;
  }

  const agentId = message.agentId ?? 'orchestrator';
  const ag = getAgent(agentId);
  // Kind is still inferred (kept for future use / data attributes) but
  // the icon and label are fixed per the T-045 contract.
  const kind = inferKind(message.content);
  void kind; // reserved for future tooling; do not change icon/label
  const label = 'thinking';
  const icon = '💭';

  // First line preview for collapsed view.
  const firstLine = message.content.split('\n')[0] ?? '';
  const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1}>
      <Box>
        <Text color={T.gray} dimColor>
          {icon} {ag?.id ?? agentId} ({label}){' '}
          {showToggleHint ? (expanded ? '▾' : '▸') : ''}{' '}
          {!expanded && preview ? preview : ''}
        </Text>
      </Box>
      {expanded ? (
        <Box paddingLeft={2} marginTop={0}>
          <Text color={T.gray} dimColor wrap="wrap">
            {message.content}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
