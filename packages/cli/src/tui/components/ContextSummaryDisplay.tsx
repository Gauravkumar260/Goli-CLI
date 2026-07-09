/**
 * components/ContextSummaryDisplay.tsx — Context source summary (T-059).
 *
 * Reference: gemini-cli's `ContextSummaryDisplay.tsx` (125 lines) shows
 * what's in the agent's context: GEMINI.md file count, MCP server count,
 * open IDE files, skill count, background process count. We implement a
 * focused version showing AGENTS.md count + MCP server count + skill count.
 *
 * Usage:
 *   <ContextSummaryDisplay
 *     agentsMdCount={2}
 *     mcpServerCount={3}
 *     skillCount={5}
 *     cols={80}
 *   />
 *
 * Renders: "📄 2 AGENTS.md · 🔌 3 MCP · 🧠 5 skills"
 * (emojis omitted in screen-reader mode; uses plain text labels)
 *
 * @module tui/components/ContextSummaryDisplay
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { useIsScreenReaderEnabled } from '../hooks/useIsScreenReaderEnabled.js';

interface Props {
  /** Number of AGENTS.md / GOLI.md / CLAUDE.md memory files found. */
  agentsMdCount?: number;
  /** Number of configured MCP servers. */
  mcpServerCount?: number;
  /** Number of skills in the catalog. */
  skillCount?: number;
  /** Number of open IDE files (if IDE integration is active). */
  ideFileCount?: number;
  /** Number of background processes. */
  backgroundProcessCount?: number;
  /** Terminal width. On narrow terminals, only non-zero counts are shown. */
  cols: number;
}

/**
 * Context source summary. Shows counts of memory files, MCP servers, skills,
 * IDE files, and background processes.
 *
 * In screen-reader mode, uses plain text labels instead of symbols.
 * On narrow terminals (<60 cols), only shows non-zero counts.
 */
export function ContextSummaryDisplay({
  agentsMdCount = 0,
  mcpServerCount = 0,
  skillCount = 0,
  ideFileCount = 0,
  backgroundProcessCount = 0,
  cols,
}: Props): React.ReactElement | null {
  const srEnabled = useIsScreenReaderEnabled();
  const narrow = cols < 60;

  const items: Array<{ symbol: string; label: string; count: number; color: string }> = [
    { symbol: '📄', label: 'AGENTS.md', count: agentsMdCount, color: T.blue },
    { symbol: '🔌', label: 'MCP', count: mcpServerCount, color: T.teal },
    { symbol: '🧠', label: 'skills', count: skillCount, color: T.purple },
    { symbol: '📁', label: 'IDE files', count: ideFileCount, color: T.green },
    { symbol: '⚙', label: 'bg', count: backgroundProcessCount, color: T.yellow },
  ];

  // Filter: on narrow terminals, only show non-zero counts.
  // On wide terminals, show all (including zeros for transparency).
  const visible = narrow ? items.filter((i) => i.count > 0) : items;

  if (visible.length === 0) {
    return srEnabled ? (
      <Text color={T.gray}>No context sources.</Text>
    ) : null;
  }

  return (
    <Box flexDirection="row">
      {visible.map((item, idx) => (
        <React.Fragment key={item.label}>
          {idx > 0 && <Text color={T.gray}> · </Text>}
          <Text>
            {srEnabled ? (
              <Text color={T.gray}>{item.label}: </Text>
            ) : (
              <Text>{item.symbol} </Text>
            )}
            <Text color={item.count > 0 ? item.color : T.gray} bold={item.count > 0}>
              {item.count}
            </Text>
            {!srEnabled && narrow && (
              <Text color={T.gray} dimColor> {item.label}</Text>
            )}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

/** Exposed for tests. */
export const __testing = { items: ['📄', '🔌', '🧠', '📁', '⚙'] };
