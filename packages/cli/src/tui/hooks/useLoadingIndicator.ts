/**
 * hooks/useLoadingIndicator.ts — State-aware loading indicator orchestration (T-057).
 *
 * Reference: gemini-cli's `useLoadingIndicator.ts` manages timer reset
 * across StreamingState transitions (Idle → Responding → WaitingForConfirmation).
 * We mirror this pattern with our own streaming state.
 *
 * The hook returns the props needed by <LoadingIndicator />:
 *   - startTime: when the current loading phase began
 *   - visible: whether to render the indicator
 *   - thought: optional subject text
 *
 * Usage:
 *   const { startTime, visible, thought } = useLoadingIndicator({
 *     state: 'responding',
 *     thought: 'analyzing auth',
 *   });
 *   return visible ? <LoadingIndicator startTime={startTime} thought={thought} ... /> : null;
 *
 * @module tui/hooks/useLoadingIndicator
 */
import { useEffect, useRef, useState } from 'react';

/** The streaming state of the agent. */
export type StreamingState = 'idle' | 'responding' | 'waiting';

interface Options {
  /** Current streaming state. */
  state: StreamingState;
  /** Optional thought subject (e.g. "analyzing src/auth.ts"). */
  thought?: string;
  /** Whether to show the indicator during 'waiting' state. Default: false. */
  showDuringWaiting?: boolean;
}

interface Return {
  /** When the current loading phase began (Date.now()). */
  startTime: number;
  /** Whether the indicator should be visible. */
  visible: boolean;
  /** The thought subject (passed through). */
  thought: string | undefined;
  /** The current streaming state. */
  state: StreamingState;
}

/**
 * Manages loading indicator state across streaming transitions.
 *
 * - When state transitions to 'responding', startTime is reset to now.
 * - When state transitions to 'idle', visible becomes false.
 * - When state transitions to 'waiting', visible depends on showDuringWaiting.
 *
 * The startTime is stored in a ref so it doesn't trigger re-renders when
 * updated; the hook returns it as a value for convenience but consumers
 * should rely on `visible` and `state` for render decisions.
 */
export function useLoadingIndicator({
  state,
  thought,
  showDuringWaiting = false,
}: Options): Return {
  const startTimeRef = useRef<number>(Date.now());
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    if (state === 'responding') {
      // Entering responding state: reset timer, show indicator.
      const now = Date.now();
      startTimeRef.current = now;
      setStartTime(now);
      setVisible(true);
    } else if (state === 'waiting') {
      // Waiting for user confirmation: show only if requested.
      setVisible(showDuringWaiting);
      // Don't reset timer — the elapsed time continues.
    } else {
      // idle: hide indicator.
      setVisible(false);
    }
  }, [state, showDuringWaiting]);

  return {
    startTime,
    visible,
    thought,
    state,
  };
}
