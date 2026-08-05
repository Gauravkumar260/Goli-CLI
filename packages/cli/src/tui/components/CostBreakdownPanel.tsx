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
import { T, getBorderStyle } from '../theme/tokens.js';

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
  /**
   * P1-12 fix (remediation plan Phase 12): optional per-model cost
   * breakdown. When provided AND containing 2+ entries, the panel
   * renders an additional "Per-model breakdown" section below the
   * totals. When absent or single-entry, the section is omitted
   * (single-model sessions don't need a breakdown).
   */
  perModelCosts?: Record<string, number>;
  /** Per-model token breakdown (paired with `perModelCosts`). */
  perModelTokens?: Record<string, { input: number; output: number }>;
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
 * average, and cost rate. P1-12 fix: optionally shows a per-model
 * breakdown when the session has used more than one model (e.g.
 * effort-routing or local-llms three-axis router sessions).
 */
export function CostBreakdownPanel({
  inputTokens,
  outputTokens,
  totalCostUsd,
  turnCount,
  cols,
  perModelCosts,
  perModelTokens,
}: Props): React.ReactElement {
  const totalTokens = inputTokens + outputTokens;
  const innerW = Math.min(cols - 4, 60);
  const avgCost = turnCount > 0 ? totalCostUsd / turnCount : 0;
  // P1-12: only render the per-model section when there are 2+ entries.
  // Single-model sessions have all their cost in one bucket and the
  // breakdown would just duplicate the totals above.
  const modelEntries = perModelCosts ? Object.entries(perModelCosts) : [];
  const showPerModel = modelEntries.length >= 2;

  return (
    <Box
      flexDirection="column"
      borderStyle={getBorderStyle() as 'round'}
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
        {/* P1-12 fix (remediation plan Phase 12): per-model breakdown.
            Rendered only when 2+ models have been used (e.g. effort
            routing sent some calls to a different model). The
            per-model token counts help debug routing decisions. */}
        {showPerModel && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={T.gray} underline>Per-model breakdown:</Text>
            {modelEntries.map(([model, cost]) => {
              const toks = perModelTokens?.[model];
              const inT = toks?.input ?? 0;
              const outT = toks?.output ?? 0;
              return (
                <Box key={model}>
                  <Text color={T.fg}>  {model}</Text>
                  <Text color={T.yellow}> {formatCost(cost)}</Text>
                  <Text color={T.gray}> ({formatTokens(inT)} in / {formatTokens(outT)} out)</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Exported for tests. */
export { formatTokens, formatCost, formatRate };
