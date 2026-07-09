/**
 * components/TokenBar.tsx — Reusable context-usage bar.
 *
 * Implements Reference Manual §5.6 color thresholds:
 *   Green  < 50%
 *   Yellow 50–80%
 *   Orange 80–95%
 *   Red    ≥ 95% — UI should nudge toward /compress
 *
 * Layout: [{bar}] N%
 */
import React from 'react';
import { Text } from 'ink';
import { T } from '../theme/tokens.js';

interface Props {
  tokens: number;
  tokenLimit: number;
}

/**
 *
 */
export function tokPct(tokens: number, limit: number): number {
  return Math.min(100, Math.floor((tokens / limit) * 100));
}

/**
 *
 */
export function tokBar(p: number): string {
  const n = Math.floor(p / 10);
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
 *
 */
export function TokenBarImpl({ tokens, tokenLimit }: Props): React.ReactElement {
  const p = tokPct(tokens, tokenLimit);
  const bar = tokBar(p);
  const color = tokColor(p);

  return (
    <Text color={color}>
      [{bar}] {p}%
    </Text>
  );
}

/**
 *
 */
export const TokenBar = React.memo(TokenBarImpl);
