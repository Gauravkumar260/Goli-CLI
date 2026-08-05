/**
 * components/DialogManager.tsx — Central dialog router (T-058).
 *
 * Reference: gemini-cli's `DialogManager.tsx` (382 lines) is a central
 * dialog router with priority-based rendering of 25+ dialog types. We
 * implement a focused version with a dialog queue + 3 priority dialogs:
 *   - AboutDialog (version info)
 *   - ThemeDialog (theme picker with preview)
 *   - HelpDialog (opens the HelpPanel)
 *
 * The DialogManager renders at most ONE dialog at a time (highest priority).
 * When a dialog is dismissed, the next-highest-priority dialog (if any)
 * becomes visible.
 *
 * Usage:
 *   <DialogManager
 *     queue={[{ type: 'about' }, { type: 'theme' }]}
 *     onDismiss={(dlg) => console.log('dismissed', dlg.type)}
 *     cols={80}
 *   />
 *
 * @module tui/components/DialogManager
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { AboutDialog } from './dialogs/AboutDialog.js';
import { ThemeDialog } from './dialogs/ThemeDialog.js';
import { HelpDialog } from './dialogs/HelpDialog.js';

/** Supported dialog types. */
export type DialogType = 'about' | 'theme' | 'help';

/** A dialog entry in the queue. */
export interface DialogEntry {
  type: DialogType;
  /** Optional payload (e.g. initial theme selection). */
  payload?: unknown;
  /** Priority (higher = more urgent). Default: 0. */
  priority?: number;
}

interface Props {
  /** The dialog queue (rendered in priority order, one at a time). */
  queue: DialogEntry[];
  /** Called when the user dismisses the current dialog. */
  onDismiss: (dialog: DialogEntry) => void;
  /** Terminal width. */
  cols: number;
}

/** Default priority for each dialog type. */
const DEFAULT_PRIORITY: Record<DialogType, number> = {
  about: 10,
  help: 20,
  theme: 30,
};

/**
 * Central dialog router. Renders the highest-priority dialog from the queue.
 * When dismissed, the next dialog (if any) becomes visible on the next render.
 *
 * If the queue is empty, renders nothing.
 */
export function DialogManager({ queue, onDismiss, cols }: Props): React.ReactElement | null {
  if (queue.length === 0) return null;

  // Sort by priority (descending) and take the first.
  const sorted = [...queue].sort((a, b) => {
    const pa = a.priority ?? DEFAULT_PRIORITY[a.type];
    const pb = b.priority ?? DEFAULT_PRIORITY[b.type];
    return pb - pa;
  });
  const current = sorted[0]!;

  const handleDismiss = () => onDismiss(current);

  switch (current.type) {
    case 'about':
      return <AboutDialog cols={cols} onDismiss={handleDismiss} />;
    case 'theme':
      return <ThemeDialog cols={cols} onDismiss={handleDismiss} />;
    case 'help':
      return <HelpDialog cols={cols} onDismiss={handleDismiss} />;
    default:
      return null;
  }
}

/** Exposed for tests. */
export const __testing = { DEFAULT_PRIORITY };
