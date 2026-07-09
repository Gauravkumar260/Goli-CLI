/**
 * Shared helpers for tool-message renderers.
 *
 * Extracted during dedup loop iteration 3 from previously-byte-identical
 * functions in `DenseToolMessage.tsx` and `ToolMessage.tsx`. Both files
 * had verbatim copies of `statusIndicator` (the running/success/failed/
 * denied/pending → glyph+color switch) and `formatDuration` (ms →
 * "500ms" / "1.5s" / "1m 5s"). The DenseToolMessage copy even carried
 * a "mirrors ToolMessage" comment acknowledging the duplication.
 *
 * Behavior is identical to both originals.
 *
 * @module tui/components/messages/tool-message-helpers
 */

import { T } from '../../theme/tokens.js';
import type { ToolState } from '../../state/types.js';

/**
 * Status indicator glyph + color based on tool state.
 *
 *   running → ◷ yellow
 *   success → ✓ green
 *   failed  → ✗ red
 *   denied  → ⊘ gray
 *   pending → ○ gray
 */
export function statusIndicator(state: ToolState): { glyph: string; color: string } {
  switch (state) {
    case 'running': return { glyph: '◷', color: T.yellow };
    case 'success': return { glyph: '✓', color: T.green };
    case 'failed':  return { glyph: '✗', color: T.red };
    case 'denied':  return { glyph: '⊘', color: T.gray };
    case 'pending':
    default:        return { glyph: '○', color: T.gray };
  }
}

/**
 * Format a duration in milliseconds as a compact human-readable string.
 *
 *   500   → "500ms"
 *   1500  → "1.5s"
 *   65000 → "1m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}
