/**
 * hooks/useShellInactivityStatus.ts — Consolidated shell-inactivity state.
 *
 * Mirrors gemini-cli's `useShellInactivityStatus.ts`. Combines
 * `useTurnActivityMonitor` + `useInactivityTimer` to produce two outputs:
 *
 *   1. `shouldShowFocusHint` — true after 5s (or 20s if silent) when an
 *      embedded shell is awaiting focus but not focused. Suppressed when
 *      redirection is active.
 *
 *   2. `inactivityStatus` — one of:
 *      - 'none' — no hint.
 *      - 'action_required' — 30s of silence after output was produced
 *        (likely a prompt waiting for input). Suppressed when redirected.
 *      - 'silent_working' — 2min of redirected output, or 60s of silent
 *        non-redirected output (e.g. `sleep 600`).
 *
 * @module useShellInactivityStatus
 */

import { useInactivityTimer } from './useInactivityTimer.js';
import {
  useTurnActivityMonitor,
  type MinimalTrackedToolCall,
  type StreamingState,
} from './useTurnActivityMonitor.js';

/** Delay (ms) before showing "press Tab to focus" hint. */
export const SHELL_FOCUS_HINT_DELAY_MS = 5_000;

/** Delay (ms) before showing "action_required" status. */
export const SHELL_ACTION_REQUIRED_TITLE_DELAY_MS = 30_000;

/** Delay (ms) before showing "silent_working" status for redirected commands. */
export const SHELL_SILENT_WORKING_TITLE_DELAY_MS = 120_000;

/** The inactivity status (drives the title icon). */
export type InactivityStatus = 'none' | 'action_required' | 'silent_working';

/** Output of {@link useShellInactivityStatus}. */
export interface ShellInactivityStatus {
  /** True if the "press Tab to focus" hint should be shown. */
  shouldShowFocusHint: boolean;
  /** The current inactivity status (drives the title icon). */
  inactivityStatus: InactivityStatus;
}

interface ShellInactivityStatusProps {
  /** The active PTY id (null when no shell is active). */
  activePtyId: number | string | null | undefined;
  /** ms since epoch of the last shell output. */
  lastOutputTime: number;
  /** The current streaming state. */
  streamingState: StreamingState;
  /** The currently-pending tool calls. */
  pendingToolCalls: MinimalTrackedToolCall[];
  /** Whether the embedded shell is currently focused. */
  embeddedShellFocused: boolean;
  /** Whether the interactive shell feature is enabled. */
  isInteractiveShellEnabled: boolean;
}

/**
 * Consolidated hook to manage all shell-related inactivity states.
 * Centralizes the timing heuristics and redirection suppression logic.
 */
export function useShellInactivityStatus({
  activePtyId,
  lastOutputTime,
  streamingState,
  pendingToolCalls,
  embeddedShellFocused,
  isInteractiveShellEnabled,
}: ShellInactivityStatusProps): ShellInactivityStatus {
  const { operationStartTime, isRedirectionActive } = useTurnActivityMonitor(
    streamingState,
    activePtyId,
    pendingToolCalls,
  );

  const isAwaitingFocus =
    !!activePtyId && !embeddedShellFocused && isInteractiveShellEnabled;

  // Derive whether output was produced by comparing the last output time to
  // when the operation started.
  const hasProducedOutput = lastOutputTime > operationStartTime;

  // 1. Focus Hint ("press Tab to focus" in the loading indicator)
  // 5s if output has been produced, 20s if silent. Suppressed if redirected.
  const shouldShowFocusHint = useInactivityTimer(
    isAwaitingFocus && !isRedirectionActive,
    lastOutputTime,
    hasProducedOutput
      ? SHELL_FOCUS_HINT_DELAY_MS
      : SHELL_FOCUS_HINT_DELAY_MS * 4,
  );

  // 2. Action Required (✋ icon in title)
  // Only if output has been produced (likely a prompt).
  // 30s of silence, SUPPRESSED if redirection is active.
  const shouldShowActionRequiredTitle = useInactivityTimer(
    isAwaitingFocus && !isRedirectionActive && hasProducedOutput,
    lastOutputTime,
    SHELL_ACTION_REQUIRED_TITLE_DELAY_MS,
  );

  // 3. Silent Working (⏲ icon in title)
  // If redirected OR if no output has been produced yet (e.g. sleep 600).
  // 2min for redirected, 60s for non-redirected silent commands.
  const shouldShowSilentWorkingTitle = useInactivityTimer(
    isAwaitingFocus && (isRedirectionActive || !hasProducedOutput),
    lastOutputTime,
    isRedirectionActive
      ? SHELL_SILENT_WORKING_TITLE_DELAY_MS
      : SHELL_ACTION_REQUIRED_TITLE_DELAY_MS * 2,
  );

  let inactivityStatus: InactivityStatus = 'none';
  if (shouldShowActionRequiredTitle) {
    inactivityStatus = 'action_required';
  } else if (shouldShowSilentWorkingTitle) {
    inactivityStatus = 'silent_working';
  }

  return {
    shouldShowFocusHint,
    inactivityStatus,
  };
}
