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
  // P1-25 fix: gate useInput with isActive so we don't capture keystrokes
  // when the dialog isn't the topmost overlay. (HelpDialog is always
  // mounted with isActive=true here since App.tsx only renders it when
  // active, but the gate is defensive for future callers.)
  useInput((input, key) => {
    if (key.escape || input === '?') {
      onDismiss();
    }
  }, { isActive: true });

  return (
    <HelpPanel cols={cols} visible={true} onClose={onDismiss} />
  );
}
