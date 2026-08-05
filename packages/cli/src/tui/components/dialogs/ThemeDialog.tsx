/**
 * components/dialogs/ThemeDialog.tsx — Theme picker dialog (T-058).
 *
 * Reference: gemini-cli's `ThemeDialog.tsx` with live preview + scope
 * selector. We implement a focused version: lists all builtin themes
 * (including no-color), shows the current selection, and lets the user
 * pick one (which writes GOLI_SKIN to env for next launch).
 *
 * Navigation: Up/Down to move, Enter to select, Esc to dismiss.
 *
 * @module tui/components/dialogs/ThemeDialog
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../../theme/tokens.js';
import {
  BUILTIN_SKIN_NAMES,
  NO_COLOR_SKIN,
  getActiveSkin,
} from '../../theme/skin-engine.js';

interface Props {
  cols: number;
  onDismiss: () => void;
  /** Called when user selects a theme. */
  onSelect?: (themeName: string) => void;
}

/** All theme names including the special 'no-color'. */
const ALL_THEMES: readonly string[] = [...BUILTIN_SKIN_NAMES, 'no-color'];

/**
 * Theme picker dialog. Lists all builtin themes, highlights the active one,
 * lets the user navigate with Up/Down and select with Enter.
 */
export function ThemeDialog({ cols, onDismiss, onSelect }: Props): React.ReactElement {
  const activeSkin = getActiveSkin();
  const initialIdx = Math.max(
    0,
    ALL_THEMES.indexOf(activeSkin.name === 'no-color' ? 'no-color' : activeSkin.name),
  );
  const [selectedIdx, setSelectedIdx] = useState(initialIdx);

  useInput((input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => (i - 1 + ALL_THEMES.length) % ALL_THEMES.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((i) => (i + 1) % ALL_THEMES.length);
      return;
    }
    if (key.return) {
      const chosen = ALL_THEMES[selectedIdx]!;
      onSelect?.(chosen);
      onDismiss();
      return;
    }
  }, { isActive: true });  // P1-25 fix: gate so we don't conflict with PromptInput

  const innerW = Math.min(cols - 4, 60);
  const themeName = ALL_THEMES[selectedIdx]!;
  const isActive = themeName === activeSkin.name;

  return (
    <Box
      borderStyle="round"
      borderColor={T.purple}
      paddingX={1}
      width={cols}
      flexDirection="column"
    >
      <Box width={innerW} justifyContent="center">
        <Text color={T.purple} bold>Themes ({ALL_THEMES.length})</Text>
      </Box>

      <Box width={innerW} marginTop={1} flexDirection="column">
        {ALL_THEMES.map((name, idx) => {
          const isSelected = idx === selectedIdx;
          const isActiveTheme = name === activeSkin.name;
          const marker = isSelected ? '▶' : ' ';
          const activeMarker = isActiveTheme ? ' (active)' : '';
          return (
            <Box key={name} flexDirection="row">
              <Text color={isSelected ? T.green : T.gray}>{marker} </Text>
              <Text
                color={isSelected ? T.fg : T.gray}
                bold={isSelected}
              >
                {name}{activeMarker}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>
          Selected: <Text color={T.teal} bold>{themeName}</Text>
          {isActive && <Text color={T.green}> (current)</Text>}
        </Text>
      </Box>
      {themeName === 'no-color' && (
        <Box width={innerW}>
          <Text color={T.yellow}>⚠ Disables all colors (NO_COLOR convention)</Text>
        </Box>
      )}

      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>
          <Text color={T.green}>↑↓</Text> navigate ·{' '}
          <Text color={T.green}>Enter</Text> select ·{' '}
          <Text color={T.green}>Esc</Text> dismiss
        </Text>
      </Box>
      <Box width={innerW}>
        <Text color={T.border}>(Takes effect on next launch. Set GOLI_SKIN={themeName} to persist.)</Text>
      </Box>
    </Box>
  );
}

/** All theme names (20 builtin + no-color). */
export { ALL_THEMES };
