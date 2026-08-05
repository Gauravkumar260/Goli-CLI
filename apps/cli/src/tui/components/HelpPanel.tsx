/**
 * components/HelpPanel.tsx — Toggleable help overlay (T-040 + T-056).
 *
 * Reference Manual §5.7: auto-generated from the live KeyMap registry,
 * matching Bubbles' `help` component pattern (§3.5). Never drifts out
 * of sync with actual bindings.
 *
 * Toggled by pressing `?` in the global useInput.
 *
 * T-056 (loop run 6, iter 4): expanded to include THREE sections,
 * mirroring gemini-cli's `Help.tsx`:
 *   1. Basics — explains `@` (file context) and `!` (shell mode) with examples.
 *   2. Commands — lists every slash command from CommandRegistry with
 *      description + kind suffix + altNames.
 *   3. Keyboard Shortcuts — the original keymap reference (unchanged).
 *
 * Also adds a `/help` command integration point: when the user types
 * `/help`, the App can set `visible=true` to open this panel.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { globalKeyMap } from '../lib/keymap.js';
import type { KeyCategory } from '../lib/keymap.js';
import { globalCommands } from '../lib/CommandRegistry.js';

interface Props {
  cols: number;
  visible: boolean;
  onClose: () => void;
  /**
   * T-056: Which section to show. Defaults to 'all' (all 3 sections).
   * Use 'basics', 'commands', or 'shortcuts' to show only one.
   */
  section?: 'all' | 'basics' | 'commands' | 'shortcuts';
}

const CATEGORY_LABELS: Record<KeyCategory, string> = {
  global: 'Global',
  navigation: 'Navigation',
  input: 'Input',
  session: 'Session',
  permission: 'Permission',
};

const CATEGORY_ORDER: KeyCategory[] = ['global', 'navigation', 'input', 'session', 'permission'];

function renderCombo(keys: string[]): string {
  if (keys.length === 0) return '(unbound)';
  return keys
    .map((k) => k.replace('ctrl', '^').replace('shift', 'S-').replace('alt', 'M-').replace('return', 'Enter'))
    .join(' ');
}

/** T-056: Render the Basics section (file context + shell mode). */
function renderBasics(): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={T.purple} bold>Basics</Text>
      <Box flexDirection="column" marginLeft={1} marginTop={0}>
        <Text>
          <Text color={T.green}>@file</Text>
          <Text color={T.gray}> — add a file as context: </Text>
          <Text color={T.teal}>@src/index.ts explain this file</Text>
        </Text>
        <Text>
          <Text color={T.green}>!command</Text>
          <Text color={T.gray}> — run a shell command: </Text>
          <Text color={T.teal}>!git status</Text>
        </Text>
        <Text>
          <Text color={T.green}>/command</Text>
          <Text color={T.gray}> — slash command: </Text>
          <Text color={T.teal}>/help</Text>
          <Text color={T.gray}>, </Text>
          <Text color={T.teal}>/theme</Text>
          <Text color={T.gray}>, </Text>
          <Text color={T.teal}>/stats</Text>
        </Text>
      </Box>
    </Box>
  );
}

/** T-056: Render the Commands section (slash command list). */
function renderCommands(): React.ReactNode {
  const commands = globalCommands.visibleEntries().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={T.purple} bold>Commands ({commands.length})</Text>
      <Box flexDirection="column" marginLeft={1} marginTop={0}>
        {commands.map((cmd) => (
          <Box key={cmd.name} flexDirection="row">
            <Box width={32} flexShrink={0}>
              <Text color={T.green}>/{cmd.name}</Text>
              {cmd.altNames && cmd.altNames.length > 0 && (
                <Text color={T.gray} dimColor> ({cmd.altNames.join(', ')})</Text>
              )}
            </Box>
            <Text color={T.fg}> {cmd.description}</Text>
            {cmd.kind && cmd.kind !== 'builtin' && (
              <Text color={T.yellow}> [{cmd.kind}]</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Render the Keyboard Shortcuts section (original T-040 behavior). */
function renderShortcuts(innerW: number): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={T.purple} bold>Keyboard Shortcuts</Text>
      {CATEGORY_ORDER.map((cat) => {
        const bindings = globalKeyMap.getByCategory(cat);
        if (bindings.length === 0) return null;
        return (
          <Box key={cat} flexDirection="column" marginTop={0}>
            <Text color={T.blue} bold>{CATEGORY_LABELS[cat]}</Text>
            {bindings.map(([action, b]) => (
              <Box key={action} flexDirection="row" marginLeft={1}>
                <Box width={20} flexShrink={0}>
                  <Text color={T.green}>{renderCombo(b.overrideKeys ?? b.defaultKeys)}</Text>
                </Box>
                <Text color={T.gray}> {b.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
      <Box width={innerW} marginTop={0}>
        <Text color={T.border}>Tip: edit ~/.goli-cli/keybindings.json to customize</Text>
      </Box>
    </Box>
  );
}

function HelpPanelImpl({ cols, visible, onClose: _onClose, section = 'all' }: Props): React.ReactElement | null {
  if (!visible) return null;

  const innerW = Math.min(cols - 4, 64);

  return (
    <Box
      borderStyle="double"
      borderColor={T.teal}
      paddingX={1}
      width={cols}
      flexDirection="column"
    >
      <Box width={innerW} justifyContent="center">
        <Text color={T.teal} bold>
          {section === 'all' ? 'Help' : section === 'basics' ? 'Basics' : section === 'commands' ? 'Commands' : 'Keyboard Shortcuts'}
        </Text>
      </Box>

      {(section === 'all' || section === 'basics') && renderBasics()}
      {(section === 'all' || section === 'commands') && renderCommands()}
      {(section === 'all' || section === 'shortcuts') && renderShortcuts(innerW)}

      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>Press </Text>
        <Text color={T.green}>?</Text>
        <Text color={T.gray}> or </Text>
        <Text color={T.green}>Esc</Text>
        <Text color={T.gray}> to close</Text>
      </Box>
    </Box>
  );
}

/**
 * Toggleable help overlay. Press `?` to show, `Esc` to dismiss.
 * Shows Basics + Commands + Keyboard Shortcuts (or a single section
 * if `section` prop is set).
 */
export const HelpPanel = React.memo(HelpPanelImpl);
