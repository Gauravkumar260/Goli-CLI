/**
 * components/TokenBar.tsx — Reusable context-usage bar.
 *
 * Implements Reference Manual §5.6 color thresholds:
 *   Green  < 50%
 *   Yellow 50–80%
 *   Orange 80–95%
 *   Red    ≥ 95% — UI should nudge toward /compress
 *
 * P1-13 fix (remediation plan Phase 13): the bar now renders 3 stacked
 * rows — input, output, and thinking tokens — instead of a single
 * combined bar. The old behavior summed input + output into one number
 * and ignored thinking tokens entirely, hiding the fact that "extended
 * thinking" models (Claude 3.5 Sonnet, gpt-oss with thinking enabled)
 * can spend a significant fraction of their budget on hidden
 * reasoning. The 3-bar layout makes this visible.
 *
 * Layout (3-bar mode):
 *   in  [████░░░░░░] 40%  12.3K/30K
 *   out [██░░░░░░░░] 20%  6.1K/30K
 *   thnk[░░░░░░░░░░]  0%  0/30K
 *
 * When the caller doesn't pass `inputTokens` / `outputTokens` /
 * `thinkingTokens` separately (legacy callers), the component falls
 * back to the single-bar layout using `tokens` / `tokenLimit`.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';

interface Props {
  /** Total tokens (legacy: input + output combined). Used for the single-bar fallback. */
  tokens: number;
  tokenLimit: number;
  /**
   * P1-13: input tokens (separate from output). When provided along
   * with `outputTokens`, the bar renders in 3-bar mode.
   */
  inputTokens?: number;
  /** P1-13: output tokens. */
  outputTokens?: number;
  /** P1-13: thinking tokens (extended-thinking models only). */
  thinkingTokens?: number;
}

/**
 * Compute the context-usage percentage, clamped to [0, 100].
 *
 * P0-4 fix: Previously divided by `limit` without guarding against zero,
 * producing `NaN` for `tokPct(N, 0)`. The NaN propagated through
 * `tokBar` → `'█'.repeat(NaN)` → `RangeError: Invalid count value`,
 * crashing the render. Any caller that hasn't initialised `tokenLimit`
 * yet (the AppStateStore default is 200000 so this is rare in prod, but
 * tests and future callers may pass 0) would hit this immediately.
 */
export function tokPct(tokens: number, limit: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(limit) || limit <= 0) return 0;
  const pct = Math.floor((tokens / limit) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 *
 */
export function tokBar(p: number): string {
  // P0-4 fix: clamp `p` to [0, 100] so a stray NaN / negative / >100
  // value cannot crash `String.prototype.repeat` with
  // `RangeError: Invalid count value`.
  const safeP = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
  const n = Math.floor(safeP / 10);
  return '\u2588'.repeat(n) + '\u2591'.repeat(10 - n);
}

/**
 *
 */
export function formatTokenLimit(limit: number): string {
  return limit >= 1000 ? `${Math.floor(limit / 1000)}K` : String(limit);
}

/**
 *
 */
export function tokColor(p: number): string {
  if (p >= 95) return T.red;
  if (p >= 80) return T.orange;
  if (p >= 50) return T.yellow;
  return T.green;
}

/**
 * P1-13: format a token count for the per-row totals.
 *   0     → "0"
 *   1234  → "1.2K"
 *   12000 → "12K"
 */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/**
 *
 */
export function TokenBarImpl({
  tokens,
  tokenLimit,
  inputTokens,
  outputTokens,
  thinkingTokens,
}: Props): React.ReactElement {
  // P1-13: if the caller provided separate input/output/thinking
  // counts, render 3 stacked bars. Otherwise fall back to the legacy
  // single-bar layout using the combined `tokens` prop.
  const useThreeBars = inputTokens !== undefined || outputTokens !== undefined;

  if (!useThreeBars) {
    // Legacy single-bar layout.
    const p = tokPct(tokens, tokenLimit);
    const bar = tokBar(p);
    const color = tokColor(p);
    return (
      <Text color={color}>
        [{bar}] {p}%
      </Text>
    );
  }

  // P1-13: 3-bar layout. Each row uses its own color (input=teal,
  // output=yellow, thinking=purple) so the user can distinguish them
  // at a glance. The percentage and absolute count are shown side by
  // side so the user sees both the relative drain and the raw token
  // count (useful when the limit is large and a small percentage
  // still represents a lot of tokens).
  const inT = inputTokens ?? 0;
  const outT = outputTokens ?? 0;
  const thinkT = thinkingTokens ?? 0;
  const inP = tokPct(inT, tokenLimit);
  const outP = tokPct(outT, tokenLimit);
  const thinkP = tokPct(thinkT, tokenLimit);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={T.teal}>in  </Text>
        <Text color={tokColor(inP)}>[{tokBar(inP)}]</Text>
        <Text color={T.gray}> {inP}% · {formatCount(inT)}/{formatCount(tokenLimit)}</Text>
      </Box>
      <Box>
        <Text color={T.yellow}>out </Text>
        <Text color={tokColor(outP)}>[{tokBar(outP)}]</Text>
        <Text color={T.gray}> {outP}% · {formatCount(outT)}/{formatCount(tokenLimit)}</Text>
      </Box>
      <Box>
        <Text color={T.purple}>thnk</Text>
        <Text color={tokColor(thinkP)}>[{tokBar(thinkP)}]</Text>
        <Text color={T.gray}> {thinkP}% · {formatCount(thinkT)}/{formatCount(tokenLimit)}</Text>
      </Box>
    </Box>
  );
}

/**
 *
 */
export const TokenBar = React.memo(TokenBarImpl);
