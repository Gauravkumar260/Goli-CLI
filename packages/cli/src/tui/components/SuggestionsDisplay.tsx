/**
 * components/SuggestionsDisplay.tsx — Slash-command autocomplete.
 *
 * T-035 (loop run 4): closes a major UI gap vs gemini-cli, which has a
 * 164-line SuggestionsDisplay.tsx with active highlighting, scrollable
 * lists, section headers, and command-kind suffixes. This implementation
 * covers the core UX: filter by prefix, navigate with arrow keys, select
 * with Enter, dismiss with Esc.
 *
 * T-044 (loop run 5): adds command-kind suffixes ([MCP], [Agent]) and
 * section headers (-- Section --) for full gemini-cli parity.
 *
 * Behavior:
 *   - Typing "/" in PromptInput shows ALL commands.
 *   - Typing "/he" filters to commands whose name starts with "he" (help).
 *   - ↑/↓ navigate the active suggestion.
 *   - Enter selects: replaces the input with "/<name> " and dispatches.
 *   - Esc dismisses the suggestion list without changing the input.
 *   - Tab accepts the active suggestion as a prefix (doesn't dispatch).
 *
 * The component is controlled: the parent (PromptInput) owns the input
 * value, the active index, and whether to show suggestions. This keeps
 * SuggestionsDisplay a pure render function — easy to test.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import type { Command, CommandKind } from '../lib/CommandRegistry.js';

interface Props {
  /** The current filtered suggestions to display. */
  suggestions: Command[];
  /** Index of the active (highlighted) suggestion. -1 = none active. */
  activeIndex: number;
  /** The user's current input (used for prefix matching display). */
  userInput: string;
  /** Maximum number of suggestions to show before scrolling. */
  maxVisible?: number;
  /** Scroll offset (how many suggestions have been scrolled past at top). */
  scrollOffset?: number;
}

/** Default max suggestions visible without scrolling. Matches gemini-cli. */
export const MAX_SUGGESTIONS_TO_SHOW = 8;

/**
 * T-044: Suffix strings for each CommandKind, rendered after the command name.
 * Matches gemini-cli's COMMAND_KIND_SUFFIX map.
 */
const COMMAND_KIND_SUFFIX: Partial<Record<CommandKind, string>> = {
  MCP: ' [MCP]',
  Agent: ' [Agent]',
  custom: ' [custom]',
  // 'builtin' has no suffix — it's the default and would add visual noise.
};

/**
 * Filter commands by the slash-prefix in user input.
 *
 *   filterCommands(allCommands, '/') → all commands
 *   filterCommands(allCommands, '/he') → [{name:'help', ...}]
 *   filterCommands(allCommands, 'hello') → [] (not a slash command)
 */
export function filterCommands(commands: Command[], userInput: string): Command[] {
  if (!userInput.startsWith('/')) return [];
  const prefix = userInput.slice(1).toLowerCase();
  if (prefix.length === 0) return commands;
  return commands.filter((c) => c.name.toLowerCase().startsWith(prefix));
}

/**
 * T-044: Get the full label for a command, including the kind suffix.
 *   {name: 'help'} → 'help'
 *   {name: 'search', kind: 'MCP'} → 'search [MCP]'
 */
export function getFullLabel(s: Command): string {
  return s.name + (s.kind ? (COMMAND_KIND_SUFFIX[s.kind] ?? '') : '');
}

/**
 * Pure render of the suggestion list. Active suggestion is highlighted
 * with T.teal; others use T.gray. Shows ▲ at top when scrolled, ▼ at
 * bottom when more suggestions exist below.
 *
 * T-044: Section headers (-- Section --) are rendered when consecutive
 * suggestions have different sectionTitle values. Commands without a
 * sectionTitle are grouped under "Built-in".
 *
 * Layout (per row):
 *   ▸ /help         Show this help and shortcut reference
 *     ^blue        ^gray
 *   ▸ /search [MCP]  Search the web
 *
 * When `activeIndex` is -1 (no selection), all rows render in T.gray.
 */
export function SuggestionsDisplay({
  suggestions,
  activeIndex,
  userInput,
  maxVisible = MAX_SUGGESTIONS_TO_SHOW,
  scrollOffset = 0,
}: Props): React.ReactElement | null {
  if (suggestions.length === 0) return null;

  const startIndex = scrollOffset;
  const endIndex = Math.min(scrollOffset + maxVisible, suggestions.length);
  const visible = suggestions.slice(startIndex, endIndex);

  // Compute the column width for the command name (+ kind suffix) so
  // descriptions align. Cap at 30 chars (was 25; +5 for " [MCP]" suffix).
  const maxNameLen = Math.min(
    30,
    Math.max(...visible.map((s) => getFullLabel(s).length)),
  );

  // Track the previous section title to detect when to render a header.
  let previousSectionTitle: string | undefined = undefined;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {scrollOffset > 0 && <Text color={T.gray}>▲</Text>}

      {visible.map((suggestion, i) => {
        const originalIndex = startIndex + i;
        const isActive = originalIndex === activeIndex;
        const nameColor = isActive ? T.teal : T.blue;
        const descColor = isActive ? T.fg : T.gray;
        const cursor = isActive ? '▸ ' : '  ';
        const fullLabel = getFullLabel(suggestion).padEnd(maxNameLen);

        // T-044: Render a section header when the sectionTitle changes.
        // Commands without a sectionTitle are grouped under "Built-in".
        const currentSection = suggestion.sectionTitle ?? 'Built-in';
        const shouldRenderHeader = currentSection !== previousSectionTitle;
        previousSectionTitle = currentSection;

        return (
          <Box key={suggestion.name} flexDirection="column">
            {shouldRenderHeader && (
              <Text color={T.gray}>-- {currentSection} --</Text>
            )}
            <Box flexDirection="row">
              <Text color={nameColor}>{cursor}</Text>
              <Text color={nameColor}>/{fullLabel}</Text>
              <Text>  </Text>
              <Text color={descColor} wrap="truncate-end">
                {suggestion.description}
              </Text>
            </Box>
          </Box>
        );
      })}

      {endIndex < suggestions.length && <Text color={T.gray}>▼</Text>}

      {suggestions.length > maxVisible && (
        <Text color={T.gray}>
          ({activeIndex >= 0 ? activeIndex + 1 : 0}/{suggestions.length})
        </Text>
      )}

      {/* Hint line — only show when the user has just started typing a slash command */}
      {userInput === '/' && (
        <Text color={T.gray}>
          ↑↓ navigate · Enter select · Tab accept · Esc dismiss
        </Text>
      )}
    </Box>
  );
}
