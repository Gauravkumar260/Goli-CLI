/**
 * components/CommandPalette.tsx — Interactive command palette (T-081).
 *
 * Reference: gemini-cli has a fuzzy-searchable command list triggered
 * by typing `/`. Goli-CLI's Ctrl+P was previously a stub that dumped all
 * command names as a system message. This component replaces it with a
 * real interactive palette:
 *
 *   ┌─ Command Palette ──────────────────────────────┐
 *   │ > /th                                           │
 *   ├─────────────────────────────────────────────────┤
 *   │ ▶ /theme        Switch color theme              │
 *   │   /tier         Set tool tier (T0/T1/T2/T3/BLK) │
 *   │   /vim          Toggle vim mode                 │
 *   └─────────────────────────────────────────────────┘
 *   ↑↓ navigate · Enter select · Esc dismiss
 *
 * Features:
 *   - Fuzzy substring filter (case-insensitive)
 *   - Shows command name + description
 *   - Up/Down navigation with scroll markers
 *   - Enter dispatches the command; Esc dismisses
 *   - Marks MCP/Agent commands with suffix
 *
 * @module tui/components/CommandPalette
 */
import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../theme/tokens.js';
import type { CommandRegistry, Command } from '../lib/CommandRegistry.js';

interface Props {
  /** The command registry to list commands from. */
  registry: CommandRegistry;
  /** Terminal width. */
  cols: number;
  /** Called when the user selects a command (with the /name string). */
  onSelect: (command: string) => void;
  /** Called when the user dismisses the palette (Esc). */
  onDismiss: () => void;
  /** Maximum number of visible suggestions. Default: 8. */
  maxVisible?: number;
}

/**
 * Filter commands by a query string (case-insensitive substring match
 * on name OR description). Returns only visible (non-hidden) commands.
 */
export function filterCommandsByQuery(
  commands: readonly Command[],
  query: string,
): readonly Command[] {
  if (query.length === 0) {
    return commands.filter((c) => !c.hidden);
  }
  const q = query.toLowerCase();
  return commands.filter(
    (c) => !c.hidden && (
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.altNames?.some((a) => a.toLowerCase().includes(q))
    ),
  );
}

/**
 * Interactive command palette. Fuzzy-filters the command registry,
 * lets the user navigate with Up/Down, and dispatches on Enter.
 */
export function CommandPalette({
  registry,
  cols,
  onSelect,
  onDismiss,
  maxVisible = 8,
}: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const allCommands = useMemo(() => registry.entries(), [registry]);
  const filtered = useMemo(
    () => filterCommandsByQuery(allCommands, query),
    [allCommands, query],
  );

  // Clamp selectedIdx when filter changes.
  const effectiveIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
  const scrollOffset = effectiveIdx >= maxVisible
    ? effectiveIdx - maxVisible + 1
    : 0;
  const visible = filtered.slice(scrollOffset, scrollOffset + maxVisible);

  useInput((input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const cmd = filtered[effectiveIdx];
      if (cmd) {
        onSelect(`/${cmd.name}`);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIdx(0);
      return;
    }
    // Printable char → append to query
    if (!key.ctrl && !key.meta && input && input.length === 1 && input >= ' ') {
      setQuery((q) => q + input);
      setSelectedIdx(0);
      return;
    }
  }, { isActive: true });  // P1-25 fix: gate so we don't conflict with PromptInput

  const innerW = Math.min(cols - 4, 70);

  return (
    <Box
      borderStyle="round"
      borderColor={T.purple}
      paddingX={1}
      width={cols}
      flexDirection="column"
    >
      <Box width={innerW} justifyContent="center">
        <Text color={T.purple} bold>Command Palette</Text>
      </Box>

      {/* Search input */}
      <Box width={innerW} marginTop={1}>
        <Text color={T.teal} bold>{'>'} </Text>
        <Text color={T.fg}>{query}</Text>
        <Text color={T.green}>│</Text>
      </Box>

      {/* Results */}
      <Box width={innerW} marginTop={1} flexDirection="column">
        {visible.length === 0 && (
          <Text color={T.gray}>No commands match "{query}"</Text>
        )}
        {visible.map((cmd, i) => {
          const absoluteIdx = scrollOffset + i;
          const isSelected = absoluteIdx === effectiveIdx;
          const marker = isSelected ? '▶ ' : '  ';
          const kindSuffix = cmd.kind === 'MCP' ? ' [MCP]' :
                             cmd.kind === 'Agent' ? ' [Agent]' : '';
          return (
            <Box key={cmd.name} flexDirection="row">
              <Text color={isSelected ? T.green : T.gray}>{marker}</Text>
              <Text color={isSelected ? T.fg : T.gray} bold={isSelected}>
                /{cmd.name}{kindSuffix}
              </Text>
              <Text color={T.border}> — </Text>
              <Text color={T.gray} wrap="truncate-end">
                {cmd.description.slice(0, 40)}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Scroll markers */}
      {filtered.length > maxVisible && (
        <Box width={innerW}>
          <Text color={T.gray} dimColor>
            {scrollOffset > 0 ? '▲ ' : '  '}
            {scrollOffset + maxVisible < filtered.length ? '▼ more' : ''}
            {' '}({filtered.length} matches)
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>
          <Text color={T.green}>↑↓</Text> navigate ·{' '}
          <Text color={T.green}>Enter</Text> select ·{' '}
          <Text color={T.green}>Esc</Text> dismiss
        </Text>
      </Box>
    </Box>
  );
}

/** Exported for tests. */
export { filterCommandsByQuery as _filterCommandsByQuery };
