/**
 * components/messages/DenseToolMessage.tsx — Compact 1-line tool view (T-077).
 *
 * Reference: gemini-cli's `DenseToolMessage.tsx` (529 lines) renders a
 * single-line summary per tool call with an expandable diff/output
 * payload. This cuts chat height by 5-10x for tool-heavy sessions.
 *
 * Layout (collapsed — default):
 *   ✓ edit_file · T1 · src/foo.ts (+5 -2)
 *
 * Layout (expanded — after Ctrl+O or click):
 *   ✓ edit_file · T1 · src/foo.ts (+5 -2)        [Ctrl+O to collapse]
 *   ┌──────────────────────────────────────────┐
 *   │  -const x = oldFunction();               │
 *   │  +const x = newFunction();               │
 *   └──────────────────────────────────────────┘
 *
 * The dense mode is enabled via the GOLI_TUI_DENSE_TOOLS=1 env var or
 * the /dense command (future). When enabled, tools in the compact
 * allowlist (read_file, edit_file, write_file, grep, glob, etc.) render
 * as DenseToolMessage; all others fall back to the full ToolMessage.
 *
 * @module tui/components/messages/DenseToolMessage
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { ToolCall, ToolState } from '../../state/types.js';
import { statusIndicator, formatDuration } from './tool-message-helpers.js';

interface Props {
  toolCall: ToolCall;
  /** Whether to show the expanded payload. Default: false (collapsed). */
  isExpanded?: boolean;
}

/**
 * Tools eligible for dense rendering. These are the high-frequency,
 * low-surprise tools where a 1-line summary is usually sufficient.
 */
export const COMPACT_TOOL_ALLOWLIST: readonly string[] = [
  'read_file',
  'edit_file',
  'write_file',
  'grep',
  'list_directory',
  'web_search',
  'web_fetch',
  // Round-2 verification item T1: removed dead refs `glob`, `ls`,
  // `read_many_files` — none of those are registered tool names.
  // Added `list_directory` (the actual name for the ls-equivalent
  // tool). The LLM only emits names from the tool definitions sent
  // to it, so the dead names never matched anything, but they
  // created the false impression that those tools existed.
];

/**
 * Check whether a tool is eligible for dense rendering.
 */
export function isCompactTool(name: string): boolean {
  return COMPACT_TOOL_ALLOWLIST.includes(name);
}

/**
 * Extract a summary stat from the tool call's meta field.
 * e.g. meta="12 lines" → "(12 lines)"; meta="+5 -2" → "(+5 -2)".
 */
function formatMeta(meta: string | undefined): string {
  if (!meta || meta.length === 0) return '';
  return ` (${meta})`;
}

/**
 * Compact 1-line tool view with expandable payload.
 *
 * The collapsed view fits on a single line:
 *   ✓ edit_file · T1 · src/foo.ts (+5 -2) · 500ms
 *
 * The expanded view adds the output/error in a bordered box.
 */
export function DenseToolMessage({
  toolCall,
  isExpanded = false,
}: Props): React.ReactElement {
  const { glyph, color } = statusIndicator(toolCall.state);
  const arg = toolCall.arg.length > 50
    ? toolCall.arg.slice(0, 49) + '…'
    : toolCall.arg;
  const meta = formatMeta(toolCall.meta);
  const duration = toolCall.durationMs !== undefined && toolCall.durationMs > 0
    ? ` · ${formatDuration(toolCall.durationMs)}`
    : '';
  const cost = toolCall.cost !== undefined && toolCall.cost > 0
    ? ` · $${toolCall.cost < 0.01 ? toolCall.cost.toFixed(4) : toolCall.cost.toFixed(2)}`
    : '';

  // T-077: Auto-expand failed tool calls (same behavior as ToolMessage).
  const effectiveExpanded = isExpanded || toolCall.state === 'failed';

  return (
    <Box flexDirection="column" marginY={0}>
      <Box flexDirection="row" paddingLeft={1}>
        <Text color={color}>{glyph}</Text>
        <Text> </Text>
        <Text color={T.purple}>{toolCall.name}</Text>
        <Text color={T.border}> · </Text>
        <Text color={T.gray}>{toolCall.tier}</Text>
        <Text color={T.border}> · </Text>
        <Text color={T.fg} wrap="truncate-end">{arg}</Text>
        {meta && <Text color={T.gray} dimColor>{meta}</Text>}
        {duration && <Text color={T.gray} dimColor>{duration}</Text>}
        {cost && <Text color={T.gray} dimColor>{cost}</Text>}
        {toolCall.error && <Text color={T.red}> ✗</Text>}
        {effectiveExpanded && (
          <Text color={T.gray} dimColor> [Ctrl+O to collapse]</Text>
        )}
      </Box>

      {/* Expanded payload */}
      {effectiveExpanded && (toolCall.output || toolCall.error) && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={T.border}
          paddingX={1}
          marginLeft={2}
          marginTop={0}
        >
          {toolCall.output && toolCall.output.split('\n').slice(0, 10).map((line, i) => (
            <Text key={i} color={T.fg} wrap="truncate-end">{line || ' '}</Text>
          ))}
          {toolCall.output && toolCall.output.split('\n').length > 10 && (
            <Text color={T.gray} dimColor>
              ... ({toolCall.output.split('\n').length - 10} more lines)
            </Text>
          )}
          {toolCall.error && !toolCall.output && (
            <Text color={T.red}>Error: {toolCall.error}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
