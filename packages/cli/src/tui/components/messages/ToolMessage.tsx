/**
 * components/messages/ToolMessage.tsx — Tool call renderer with sticky header,
 * expandable results, and MCP progress indicator.
 *
 * T-037 (loop run 4): initial implementation — status indicator + name + tier + arg.
 * T-046 (loop run 5): adds expandable results, sticky header, MCP progress bar.
 *
 * Layout (collapsed):
 *   ◷ bash · T1 · ls -la /tmp
 *
 * Layout (expanded):
 *   ◷ bash · T1 · ls -la /tmp                    [Ctrl+O to collapse]
 *   ┌──────────────────────────────────────────┐
 *   │ total 16                                  │
 *   │ drwxr-xr-x  2 root root 4096 ...          │
 *   │ -rw-r--r--  1 root root   42 ...          │
 *   └──────────────────────────────────────────┘
 *
 * Layout (MCP tool with progress):
 *   ◷ mcp-search · T2 · "query"                 [████████░░░░] 60%
 *   Searching the web...
 *
 * Status indicators:
 *   ◷ running (yellow)
 *   ✓ success (green)
 *   ✗ failed (red)
 *   ⊘ denied (gray)
 *
 * The expanded state is controlled by the `isExpanded` prop. The parent
 * (AgentMessage) tracks expanded call IDs and toggles them on Ctrl+O.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';
import type { ToolCall, ToolState } from '../../state/types.js';
import { statusIndicator, formatDuration } from './tool-message-helpers.js';

interface Props {
  toolCall: ToolCall;
  /** Whether to show the expanded result view. Default: false (collapsed). */
  isExpanded?: boolean;
  /** Available terminal height (for clamping expanded output). */
  availableTerminalHeight?: number;
}

/**
 * Check if a tool name is an MCP tool (starts with 'mcp-' or contains '_').
 * MCP tools get the progress indicator when running.
 */
function isMcpTool(name: string): boolean {
  return name.startsWith('mcp-') || name.includes('_');
}

/**
 * T-046: Render a progress bar for MCP tools.
 *
 *   [████████░░░░░░░░] 50%
 *
 * The bar is always 16 chars wide (8 filled + 8 empty at 50%).
 */
function McpProgressIndicator({ progress, total, message }: {
  progress: number;
  total?: number;
  message?: string;
}): React.ReactElement {
  const barWidth = 16;
  const ratio = total !== undefined && total > 0 ? Math.min(progress / total, 1) : progress;
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const pct = Math.round(ratio * 100);

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={0}>
      <Box>
        <Text color={T.teal}>[</Text>
        <Text color={T.teal}>{'█'.repeat(filled)}</Text>
        <Text color={T.gray}>{'░'.repeat(empty)}</Text>
        <Text color={T.teal}>]</Text>
        <Text color={T.gray}> {pct}%</Text>
      </Box>
      {message && (
        <Text color={T.gray} dimColor>{message}</Text>
      )}
    </Box>
  );
}

/**
 * T-046: Render the expanded result view in a bordered box.
 * The output is clamped to availableTerminalHeight lines.
 */
function ExpandedResult({ output, availableTerminalHeight }: {
  output: string;
  availableTerminalHeight?: number;
}): React.ReactElement {
  const lines = output.split('\n');
  const maxLines = availableTerminalHeight !== undefined
    ? Math.min(lines.length, Math.max(3, availableTerminalHeight))
    : lines.length;
  const visible = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={T.border}
      paddingX={1}
      marginY={0}
      marginLeft={2}
    >
      {visible.map((line, i) => (
        <Text key={i} color={T.fg} wrap="truncate-end">{line || ' '}</Text>
      ))}
      {truncated && (
        <Text color={T.gray} dimColor>
          ... ({lines.length - maxLines} more lines — Ctrl+O to collapse)
        </Text>
      )}
    </Box>
  );
}

/**
 * T-072: Format tool cost in human-readable form.
 *   0.0001 → "$0.0001"
 *   0.05 → "$0.05"
 *   1.5 → "$1.50"
 */
function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Render a single tool call. Collapsed by default; expanded shows the
 * full output in a bordered box. MCP tools show a progress bar when running.
 *
 * T-072: Failed tool calls auto-expand to show the error output.
 * T-072: Duration and cost are shown in the header when available.
 */
export function ToolMessage({
  toolCall,
  isExpanded = false,
  availableTerminalHeight,
}: Props): React.ReactElement {
  const { glyph, color } = statusIndicator(toolCall.state);
  const arg = toolCall.arg.length > 60
    ? toolCall.arg.slice(0, 59) + '…'
    : toolCall.arg;
  const showProgress = toolCall.state === 'running' && isMcpTool(toolCall.name);
  // T-072: Auto-expand failed tool calls so errors are visible.
  const effectiveExpanded = isExpanded || toolCall.state === 'failed';
  const showExpanded = effectiveExpanded && (toolCall.output !== undefined || toolCall.error !== undefined);

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
        {/* T-072: Duration + cost badges */}
        {toolCall.durationMs !== undefined && toolCall.durationMs > 0 && (
          <Text color={T.gray} dimColor> · {formatDuration(toolCall.durationMs)}</Text>
        )}
        {toolCall.cost !== undefined && toolCall.cost > 0 && (
          <Text color={T.gray} dimColor> · {formatCost(toolCall.cost)}</Text>
        )}
        {toolCall.meta && toolCall.state === 'success' && (
          <Text color={T.gray} dimColor> ({toolCall.meta})</Text>
        )}
        {toolCall.error && (
          <Text color={T.red}> ({toolCall.error})</Text>
        )}
        {effectiveExpanded && (
          <Text color={T.gray} dimColor> [Ctrl+O to collapse]</Text>
        )}
      </Box>

      {/* T-046: MCP progress indicator for running MCP tools */}
      {showProgress && toolCall.meta && (
        <McpProgressIndicator
          progress={parseFloat(toolCall.meta) || 0}
          message={toolCall.output}
        />
      )}

      {/* T-046: Expanded result view */}
      {showExpanded && toolCall.output && (
        <ExpandedResult
          output={toolCall.output}
          availableTerminalHeight={availableTerminalHeight}
        />
      )}
      {showExpanded && toolCall.error && !toolCall.output && (
        <ExpandedResult
          output={`Error: ${toolCall.error}`}
          availableTerminalHeight={availableTerminalHeight}
        />
      )}
    </Box>
  );
}
