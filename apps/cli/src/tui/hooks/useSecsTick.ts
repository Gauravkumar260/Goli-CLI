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

// P1-12 fix: Track the unsubscribe function returned by `subscribeSpin`
// so we can release it when the last listener leaves. Previously `emit`
// was permanently subscribed to the spinner ticker — even after all
// consumers unmounted, `emit` was still called 10×/second iterating an
// empty Set, and the spinner ticker could never shut down (it refcounts
// subscribers and `emit` was always one).
let spinUnsub: (() => void) | null = null;

function emit(): void {
  const now = Date.now();
  for (const fn of secsListeners) fn((now - epochStart) / 1000);
}

function ensureRunning(): void {
  // Reuse the spinner ticker — it's already running at 10fps.
  if (secsListeners.size === 0 && spinUnsub === null) {
    epochStart = Date.now();
    spinUnsub = subscribeSpin(emit);
  }
}

function maybeStop(): void {
  // P1-12 fix: When the last listener leaves, unsubscribe `emit` from
  // the spinner ticker so the ticker can refcount down to zero and
  // shut down. Previously this was a no-op, leaking the subscription
  // forever.
  if (secsListeners.size === 0 && spinUnsub !== null) {
    spinUnsub();
    spinUnsub = null;
  }
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
