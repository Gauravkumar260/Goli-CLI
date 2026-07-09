/**
 * hooks/useTurnActivityMonitor.ts — Tracks operation start time + redirection state.
 *
 * Mirrors gemini-cli's `useTurnActivityMonitor.ts`. The hook:
 *   - Records `operationStartTime` (ms since epoch) when a new turn starts
 *     (i.e. when `streamingState` transitions to "Responding").
 *   - Derives `isRedirectionActive` from the pending tool calls' args —
 *     true if any `run_shell_command` arg contains `>`, `>>`, `2>`, `|`, or `&`.
 *
 * These two values feed `useShellInactivityStatus` to decide which
 * inactivity hint (if any) to show.
 *
 * @module useTurnActivityMonitor
 */

import { useEffect, useRef, useState } from 'react';

/** A minimal tool-call shape — only what we need to inspect args. */
export interface MinimalTrackedToolCall {
  /** Tool name (e.g. `run_shell_command`). */
  name: string;
  /** The tool's args (we inspect this for redirection operators). */
  args: Record<string, unknown>;
}

/** Streaming state — mirrors gemini-cli's StreamingState. */
export type StreamingState = 'Idle' | 'Responding' | 'Waiting';

/** Output of the hook. */
export interface TurnActivityState {
  /** ms since epoch when the current operation started. Reset on each Responding transition. */
  operationStartTime: number;
  /** True if any pending run_shell_command has a redirection operator in its command arg. */
  isRedirectionActive: boolean;
}

// Characters that indicate shell redirection — the command's output is
// going somewhere other than the terminal, so "no terminal output" is
// expected and shouldn't trigger an "action required" hint.
const REDIRECTION_PATTERNS = [
  />>?/u, // > or >>
  /\b2>&?1\b/u, // 2>&1 or 2>1
  /\|/u, // pipe
  /&$/u, // background
];

/**
 * Check whether a command string contains a redirection operator.
 * Exported for unit testing.
 */
export function hasRedirection(command: string): boolean {
  return REDIRECTION_PATTERNS.some((re) => re.test(command));
}

/**
 * Track operation start time + redirection state for the current turn.
 *
 * @param streamingState — The current streaming state.
 * @param activePtyId — The active PTY id (null when no shell is active).
 * @param pendingToolCalls — The currently-pending tool calls.
 */
export function useTurnActivityMonitor(
  streamingState: StreamingState,
  activePtyId: number | string | null | undefined,
  pendingToolCalls: MinimalTrackedToolCall[],
): TurnActivityState {
  const [operationStartTime, setOperationStartTime] = useState<number>(Date.now());
  const prevStreamingRef = useRef<StreamingState>(streamingState);

  // Reset operationStartTime when transitioning INTO Responding.
  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (streamingState === 'Responding' && prev !== 'Responding') {
      setOperationStartTime(Date.now());
    }
    prevStreamingRef.current = streamingState;
  }, [streamingState]);

  // Also reset when the active PTY changes (new shell session).
  useEffect(() => {
    if (activePtyId !== undefined && activePtyId !== null) {
      setOperationStartTime(Date.now());
    }
  }, [activePtyId]);

  // Derive isRedirectionActive from pending tool calls.
  const isRedirectionActive = (() => {
    if (!pendingToolCalls || pendingToolCalls.length === 0) return false;
    for (const tc of pendingToolCalls) {
      if (tc.name !== 'run_shell_command' && tc.name !== 'bash') continue;
      const cmd = typeof tc.args['command'] === 'string'
        ? (tc.args['command'] as string)
        : '';
      if (cmd && hasRedirection(cmd)) return true;
    }
    return false;
  })();

  return { operationStartTime, isRedirectionActive };
}
