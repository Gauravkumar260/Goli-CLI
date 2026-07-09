/**
 * components/dialogs/HelpDialog.tsx — Help dialog wrapper (T-058).
 *
 * Wraps the existing HelpPanel in a dismissible dialog frame. Press Esc
 * or ? to dismiss.
 *
 * @module tui/components/dialogs/HelpDialog
 */
import React from 'react';
import { useInput } from 'ink';
import { HelpPanel } from '../HelpPanel.js';

interface Props {
  cols: number;
  onDismiss: () => void;
}

/**
 * Help dialog. Renders the full HelpPanel (Basics + Commands + Shortcuts)
 * and dismisses on Esc or ?.
 */
export function HelpDialog({ cols, onDismiss }: Props): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || input === '?') {
      onDismiss();
    }
  });

  return (
    <HelpPanel cols={cols} visible={true} onClose={onDismiss} />
  );
}
