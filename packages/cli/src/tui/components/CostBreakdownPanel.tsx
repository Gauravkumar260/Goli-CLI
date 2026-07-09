/**
 * components/CostBreakdownPanel.tsx — Live cost breakdown panel (T-096).
 *
 * Reference: gemini-cli's StatsDisplay + QuotaDisplay show token/cost
 * stats inline. Goli-CLI's /stats is text-only with no live panel.
 *
 * This component renders a compact bordered panel showing:
 *   - Total tokens (input + output)
 *   - Total cost (USD)
 *   - Per-turn average
 *   - Cost rate ($/1K tokens)
 *
 * Layout:
 *   ┌─ Cost Breakdown ──────────────────────────────┐
 *   │ Tokens: 12,345 (in: 10K · out: 2.3K)          │
 *   │ Cost:   $0.0234                                │
 *   │ Turns:  5  ·  avg $0.0047/turn                 │
 *   │ Rate:   $0.0019/1K tokens                      │
 *   └────────────────────────────────────────────────┘
 *
 * @module tui/components/CostBreakdownPanel
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';

interface Props {
  /** Total input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Number of turns completed. */
  turnCount: number;
  /** Terminal width. */
  cols: number;
}

/**
 * Format a token count with thousands separator (e.g. 12345 → "12,345").
 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/**
 * Format a USD cost with appropriate precision.
 */
function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format cost per 1K tokens.
 */
function formatRate(usd: number, tokens: number): string {
  if (tokens === 0) return '$0.00/1K';
  const rate = (usd / tokens) * 1000;
  return `${formatCost(rate)}/1K`;
}

/**
 * Live cost breakdown panel. Shows token counts, total cost, per-turn
 * average, and cost rate.
 */
export function CostBreakdownPanel({
  inputTokens,
  outputTokens,
  totalCostUsd,
  turnCount,
  cols,
}: Props): React.ReactElement {
  const totalTokens = inputTokens + outputTokens;
  const innerW = Math.min(cols - 4, 60);
  const avgCost = turnCount > 0 ? totalCostUsd / turnCount : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={T.green}
      paddingX={1}
      width={cols}
    >
      <Box width={innerW}>
        <Text color={T.green} bold>Cost Breakdown</Text>
      </Box>
      <Box width={innerW} flexDirection="column" marginTop={0}>
        <Box>
          <Text color={T.gray}>Tokens: </Text>
          <Text color={T.fg} bold>{formatTokens(totalTokens)}</Text>
          <Text color={T.gray}> (in: {formatTokens(inputTokens)} · out: {formatTokens(outputTokens)})</Text>
        </Box>
        <Box>
          <Text color={T.gray}>Cost:   </Text>
          <Text color={T.yellow} bold>{formatCost(totalCostUsd)}</Text>
        </Box>
        <Box>
          <Text color={T.gray}>Turns:  </Text>
          <Text color={T.fg}>{turnCount}</Text>
          <Text color={T.gray}> · avg {formatCost(avgCost)}/turn</Text>
        </Box>
        <Box>
          <Text color={T.gray}>Rate:   </Text>
          <Text color={T.teal}>{formatRate(totalCostUsd, totalTokens)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

/** Exported for tests. */
export { formatTokens, formatCost, formatRate };
