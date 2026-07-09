/**
 * hooks/useInactivityTimer.ts — Returns true after a delay of inactivity.
 *
 * "Inactivity" is defined as the `trigger` value not changing for `delayMs`
 * milliseconds. When `trigger` changes, the timer resets. When `isActive`
 * is false, the hook always returns false.
 *
 * Use cases:
 *   - Show "press Tab to focus" hint after 5s of no shell output.
 *   - Show "action required" title after 30s of silence.
 *   - Show "silent working" title after 2min of redirected output.
 *
 * @module useInactivityTimer
 */

import { useState, useEffect } from 'react';

/**
 * @param isActive — Whether the timer should be running. When false, returns false.
 * @param trigger — Any value that, when changed, resets the inactivity timer.
 * @param delayMs — The delay in milliseconds before considering the state inactive. Default 5000.
 * @returns true if `delayMs` has elapsed since the last `trigger` change (and `isActive` is true).
 */
export function useInactivityTimer(
  isActive: boolean,
  trigger: unknown,
  delayMs: number = 5000,
): boolean {
  const [isInactive, setIsInactive] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setIsInactive(false);
      return;
    }

    setIsInactive(false);
    const timer = setTimeout(() => {
      setIsInactive(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [isActive, trigger, delayMs]);

  return isInactive;
}
