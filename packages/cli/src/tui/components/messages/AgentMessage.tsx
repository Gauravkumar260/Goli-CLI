/**
 * components/messages/AgentMessage.tsx — Agent message renderer.
 *
 * T-037 (loop run 4): splits MessageBubble into specialized renderers.
 * AgentMessage renders the agent-colored header (id · tokens) + content,
 * mirroring gemini-cli's GeminiMessage.tsx (53 LOC) + GeminiMessageContent.tsx.
 *
 * Layout:
 *   orchestrator · 1234 tokens
 *   ◷ bash · T1 · ls -la /tmp           (tool calls, if any)
 *   ✓ read_file · T1 · package.json
 *   <agent content, possibly multi-line>
 *
 * Performance: uses an indexOf-based line splitter instead of
 * `content.split('\n')` to avoid allocating a fresh array + N substrings
 * on every render frame during streaming. At 60fps with a 4KB message,
 * that's ~240KB/s of GC pressure avoided.
 */
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import { getAgent } from '../../theme/agents.js';
import { ToolMessage } from './ToolMessage.js';
import { DenseToolMessage, isCompactTool } from './DenseToolMessage.js';
import { useExpandedTools } from '../../hooks/useExpandedTools.js';
import { renderMarkdown } from '../../lib/markdown.js';
import type { Message } from '../../state/types.js';

/**
 * T-077: Check whether dense/compact tool mode is enabled.
 * Enabled via GOLI_TUI_DENSE_TOOLS=1 env var.
 */
function isDenseModeEnabled(): boolean {
  return process.env['GOLI_TUI_DENSE_TOOLS'] === '1' ||
         process.env['GOLI_TUI_DENSE_TOOLS'] === 'true';
}

interface Props {
  message: Message;
}

/** Sentinel for blank lines — hoisted so it isn't re-allocated. */
const EMPTY_LINE = ' ';

/**
 * Render N lines from `content` using an indexOf loop instead of
 * `content.split('\n')`. Same output, less GC pressure.
 */
function renderLines(content: string): React.ReactNode {
  if (content.length === 0) return null;
  const firstNL = content.indexOf('\n');
  if (firstNL === -1) {
    return <Text wrap="wrap">{content}</Text>;
  }
  const out: React.ReactNode[] = [];
  let start = 0;
  let i = 0;
  for (let j = 0; (j = content.indexOf('\n', start)) !== -1; i++) {
    const slice = content.slice(start, j);
    out.push(<Text key={i} wrap="wrap">{slice || EMPTY_LINE}</Text>);
    start = j + 1;
  }
  if (start < content.length) {
    out.push(<Text key={i} wrap="wrap">{content.slice(start) || EMPTY_LINE}</Text>);
  } else if (out.length === 0) {
    out.push(<Text key={i} wrap="wrap">{EMPTY_LINE}</Text>);
  }
  return out;
}

/**
 * Render an agent message. Header shows agent id (colored) + token count
 * (gray). Tool calls (if any) render via ToolMessage above the content.
 * Content is rendered via the indexOf-based line splitter for streaming
 * performance.
 */
export function AgentMessage({ message }: Props): React.ReactElement {
  // T-091: Use the global expanded-tools registry so /expand command
  // and keybindings can toggle expansion. Auto-expand for failed calls
  // is handled inside ToolMessage/DenseToolMessage.
  const expandedIds = useExpandedTools();

  // T-089 (refinement): ALL hooks must be called before any early return
  // to satisfy the Rules of Hooks. Previously `useMemo` was called after
  // the type-narrowing guard, which would crash React if a non-agent
  // message was ever routed here (hook order would change between renders).
  const rendered = React.useMemo(() => {
    if (message.type !== 'agent') return null;
    // T-040: Use markdown rendering for completed messages; fall back to
    // the indexOf-based line splitter during streaming (so partial markdown
    // constructs don't flicker as they accumulate).
    if (message.streaming) {
      return renderLines(message.content);
    }
    return renderMarkdown(message.content);
  }, [message]);

  if (message.type !== 'agent') {
    // Type narrowing guard — should never fire because MessageBubble
    // only routes agent messages here.
    return <Text color={T.red}>[AgentMessage: non-agent message]</Text>;
  }
  const agentId = message.agentId ?? 'orchestrator';
  const ag = getAgent(agentId);
  const tok = message.tok;

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={1}>
      <Box>
        <Text color={ag?.c ?? T.blue}>{ag?.id ?? agentId}</Text>
        <Text color={T.border}> · </Text>
        {tok !== undefined && <Text color={T.gray}>{tok} tokens</Text>}
      </Box>
      {message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {message.toolCalls.map((tc) => {
            // T-077: Route to DenseToolMessage when dense mode is enabled
            // and the tool is in the compact allowlist; otherwise use the
            // full ToolMessage.
            const useDense = isDenseModeEnabled() && isCompactTool(tc.name);
            return useDense ? (
              <DenseToolMessage
                key={tc.id}
                toolCall={tc}
                isExpanded={expandedIds.has(tc.id)}
              />
            ) : (
              <ToolMessage
                key={tc.id}
                toolCall={tc}
                isExpanded={expandedIds.has(tc.id)}
              />
            );
          })}
        </Box>
      )}
      <Box flexDirection="column">
        {rendered}
      </Box>
    </Box>
  );
}
