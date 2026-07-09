/**
 * components/ShortcutsHelp.tsx — Passive inline shortcuts panel (T-056).
 *
 * Reference: gemini-cli's `ShortcutsHelp.tsx` — a 3-column panel shown
 * passively below the input when the user is idle, listing the 10 most-
 * used shortcuts in a stable column order. Collapses to 1 column on
 * narrow terminals.
 *
 * Unlike HelpPanel (the full `?` overlay), ShortcutsHelp is always
 * visible while the user is typing — a gentle reminder of useful keys
 * without requiring a help-mode toggle.
 *
 * Usage:
 *   <ShortcutsHelp cols={80} idleMs={2000} />  // shows after 2s idle
 *   <ShortcutsHelp cols={80} alwaysShow />     // shows immediately
 *
 * @module tui/components/ShortcutsHelp
 */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';

/** A shortcut entry: key combo + description. */
export interface ShortcutEntry {
  key: string;
  description: string;
}

/**
 * The 10 most-used shortcuts, in stable column order.
 * Mirrors gemini-cli's ShortcutsHelp layout.
 */
export const DEFAULT_SHORTCUTS: readonly ShortcutEntry[] = [
  { key: 'Enter',        description: 'send' },
  { key: 'Shift+Enter',  description: 'newline' },
  { key: 'Up/Down',      description: 'history' },
  { key: 'Tab',          description: 'autocomplete' },
  { key: 'Ctrl+C',       description: 'exit' },
  { key: 'Ctrl+L',       description: 'clear' },
  { key: 'Ctrl+D',       description: 'exit on empty' },
  { key: '?',            description: 'help' },
  { key: 'Esc',          description: 'dismiss / cancel' },
  { key: '/',            description: 'slash commands' },
] as const;

interface Props {
  /** Terminal width in columns. */
  cols: number;
  /**
   * Show the panel after this many ms of input idle.
   * Default: 2000 (2s). Set to 0 to show immediately.
   */
  idleMs?: number;
  /** Always show, regardless of idle state. */
  alwaysShow?: boolean;
  /** Custom shortcuts (defaults to DEFAULT_SHORTCUTS). */
  shortcuts?: readonly ShortcutEntry[];
}

/**
 * Passive shortcuts help panel. Shows after `idleMs` of inactivity.
 *
 * Layout: 3 columns of "key  description" pairs on wide terminals (>=70 cols),
 * 2 columns on medium (50-69 cols), 1 column on narrow (<50 cols).
 */
export function ShortcutsHelp({
  cols,
  idleMs = 2000,
  alwaysShow = false,
  shortcuts = DEFAULT_SHORTCUTS,
}: Props): React.ReactElement | null {
  // T-056: When idleMs=0, treat as alwaysShow (initial state = visible).
  const showImmediately = alwaysShow || idleMs === 0;
  const [visible, setVisible] = useState(showImmediately);

  useEffect(() => {
    if (showImmediately) {
      setVisible(true);
      return;
    }
    // Show after idleMs.
    const id = setTimeout(() => setVisible(true), idleMs);
    return () => clearTimeout(id);
  }, [idleMs, showImmediately]);

  if (!visible) return null;

  // Determine column count based on terminal width.
  const numCols = cols >= 70 ? 3 : cols >= 50 ? 2 : 1;
  const colWidth = Math.floor(cols / numCols);
  const rowsPerCol = Math.ceil(shortcuts.length / numCols);

  // Build column-major layout.
  const columns: React.ReactNode[] = [];
  for (let c = 0; c < numCols; c++) {
    const colItems: React.ReactNode[] = [];
    for (let r = 0; r < rowsPerCol; r++) {
      const idx = c * rowsPerCol + r;
      if (idx >= shortcuts.length) break;
      const entry = shortcuts[idx]!;
      // T-056: cap key column at 14 chars; description takes the rest.
      const keyWidth = Math.min(14, Math.max(8, colWidth - 12));
      colItems.push(
        <Box key={idx} flexDirection="row">
          <Box width={keyWidth} flexShrink={0}>
            <Text color={T.green}>{entry.key}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={T.gray} dimColor wrap="truncate">{entry.description}</Text>
          </Box>
        </Box>,
      );
    }
    columns.push(
      <Box key={c} flexDirection="column" width={colWidth}>
        {colItems}
      </Box>,
    );
  }

  return (
    <Box flexDirection="row" marginTop={0}>
      {columns}
    </Box>
  );
}
