/**
 * hooks/useSecsTick.ts — Subscribes a component to the 10fps elapsed-seconds ticker.
 *
 * Like useSpinIndex but for the "⏱ N.Ns" timer. Components that
 * display elapsed time (InfoBox, StatusBar, PipelineTrace) call
 * this hook and re-render at 10fps. Components that don't (e.g.
 * AgentStateBar, HistoryScroll, WelcomeTip) NEVER re-render from
 * this hook.
 */
import { useEffect, useState } from 'react';
import { subscribeSpin, getCurrentSpinIndex } from '../state/spinTicker.js';

// We piggyback on the same 10fps ticker but with a different state
// shape: each call to useSecsTick returns a different `secs` value
// calculated from the current spin index + an offset maintained by
// the first subscriber.

let epochStart = Date.now();
const secsListeners = new Set<(s: number) => void>();

function emit(): void {
  const now = Date.now();
  for (const fn of secsListeners) fn((now - epochStart) / 1000);
}

function ensureRunning(): void {
  // Reuse the spinner ticker — it's already running at 10fps.
  if (secsListeners.size === 0) {
    epochStart = Date.now();
    subscribeSpin(emit);
  }
}

function maybeStop(): void {
  // We don't stop the underlying spinner ticker here; it has its
  // own refcount. secsListeners just gets cleared on cleanup.
}

/**
 *
 */
export function useSecsTick(): [number] {
  const [secs, setSecs] = useState<number>(() => (Date.now() - epochStart) / 1000);
  useEffect(() => {
    ensureRunning();
    secsListeners.add(setSecs);
    // Sync to current value immediately on mount.
    setSecs((Date.now() - epochStart) / 1000);
    return () => {
      secsListeners.delete(setSecs);
      maybeStop();
    };
  }, []);
  return [secs];
}

// Use this to reset the epoch (e.g. when a new agent run starts).
/**
 *
 */
export function resetSecsEpoch(): void {
  epochStart = Date.now();
  emit();
}

// Re-export getCurrentSpinIndex for callers that need it
/**
 *
 */
export { getCurrentSpinIndex };
