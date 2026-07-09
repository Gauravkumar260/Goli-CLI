/**
 * components/ToastDisplay.tsx — Transient UI feedback messages.
 *
 * T-036 (loop run 4): closes a UI gap vs gemini-cli, which has a 92-line
 * ToastDisplay.tsx with 6 toast types (ctrlCPressedOnce, transientMessage,
 * ctrlDPressedOnce, escapePrompt, queueErrorMessage, expandableHint).
 *
 * This implementation provides 5 toast types that fire on user interactions:
 *
 *   1. ctrlCPressedOnce (warning) — "Press Ctrl+C again to exit."
 *   2. ctrlDPressedOnce (warning) — "Press Ctrl+D again to exit."
 *   3. escapePrompt     (hint)   — "Press Esc again to clear prompt."
 *                                  (or "to rewind" if prompt is empty)
 *   4. transientMessage (any)    — caller-supplied text + severity
 *   5. queueError       (error)  — queue-overload error message
 *
 * Toasts auto-dismiss after the second keypress or after a 3-second timeout.
 *
 * The component is controlled: the parent (App) owns the toast state via
 * AppStateStore. ToastDisplay is a pure render that picks the highest-
 * priority toast and renders it.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';

/** Toast severity levels. */
export type ToastSeverity = 'warning' | 'hint' | 'error';

/** A transient toast message. */
export interface ToastMessage {
  /** Severity determines color: warning=yellow, hint=gray, error=red. */
  severity: ToastSeverity;
  /** The text to display. */
  text: string;
  /** Optional timestamp (ms since epoch) for timeout tracking. */
  timestamp?: number;
}

interface Props {
  /** The current toast to display, or null/undefined for none. */
  toast?: ToastMessage | null;
  /** Whether Ctrl+C has been pressed once (sticky until second press or timeout). */
  ctrlCPressedOnce?: boolean;
  /** Whether Ctrl+D has been pressed once. */
  ctrlDPressedOnce?: boolean;
  /** Whether Esc has been pressed once (with a non-empty prompt). */
  escapePressedOnce?: boolean;
  /** Whether the prompt is currently empty (affects Esc message). */
  isPromptEmpty?: boolean;
  /** Whether there is message history (affects Esc → rewind vs clear). */
  hasHistory?: boolean;
}

/** Map severity → color token. */
function colorForSeverity(severity: ToastSeverity): string {
  switch (severity) {
    case 'warning': return T.yellow;
    case 'error':   return T.red;
    case 'hint':
    default:        return T.gray;
  }
}

/**
 * Decide which toast to show, in priority order:
 *   1. ctrlCPressedOnce (warning — exit confirmation)
 *   2. ctrlDPressedOnce (warning — exit confirmation)
 *   3. queueError / transientMessage (error > warning > hint)
 *   4. escapePressedOnce (hint — clear/rewind)
 *
 * This priority matches gemini-cli's shouldShowToast logic.
 */
export function pickToast(props: Props): ToastMessage | null {
  const {
    toast,
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    escapePressedOnce,
    isPromptEmpty = true,
    hasHistory = false,
  } = props;

  if (ctrlCPressedOnce) {
    return { severity: 'warning', text: 'Press Ctrl+C again to exit.' };
  }
  if (ctrlDPressedOnce) {
    return { severity: 'warning', text: 'Press Ctrl+D again to exit.' };
  }
  if (toast && toast.severity === 'error') {
    return toast;
  }
  if (escapePressedOnce) {
    // If prompt is empty AND there's history → "rewind" suggestion.
    // If prompt has text → "clear prompt" suggestion.
    // If prompt is empty AND no history → no toast (nothing to rewind).
    if (isPromptEmpty && !hasHistory) return null;
    const action = isPromptEmpty ? 'rewind' : 'clear prompt';
    return {
      severity: 'hint',
      text: `Press Esc again to ${action}.`,
    };
  }
  if (toast) {
    return toast;
  }
  return null;
}

/**
 * Pure render. Picks the highest-priority toast and renders it in a
 * single-line Box. Returns null when no toast is active.
 */
export function ToastDisplay(props: Props): React.ReactElement | null {
  const active = pickToast(props);
  if (!active) return null;

  const color = colorForSeverity(active.severity);
  return (
    <Box paddingLeft={1}>
      <Text color={color}>{active.text}</Text>
    </Box>
  );
}

/** Default auto-dismiss timeout (ms). */
export const TOAST_TIMEOUT_MS = 3000;
