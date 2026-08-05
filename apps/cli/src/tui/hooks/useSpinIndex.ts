/**
 * hooks/useSpinIndex.ts — Subscribe a component to the global spinner ticker.
 *
 * Returns the current spinner index. When the ticker fires, ONLY this
 * hook's component re-renders (its sibling subtree is unaffected).
 *
 * Performance tuning (no design change):
 *   - On mount, immediately sync the local index to the ticker's
 *     current value so the subscriber renders the correct glyph on the
 *     first paint — even if the next tick is 80ms away. Without this,
 *     a remounting component (e.g. when SplashBox unmounts and
 *     HeaderBar takes over after the first user turn) shows the
 *     spinner's `currentIdx = 0` glyph for ~80ms before catching up.
 *     Visually identical at the page level (the spinner updates fast
 *     enough that the user doesn't notice) but a sub-frame flicker in
 *     remount scenarios.
 *   - Same pattern as `useSecsTick`, which already does this for the
 *     elapsed-seconds ticker.
 */
import { useEffect, useState } from 'react';
import { subscribeSpin, getCurrentSpinIndex } from '../state/spinTicker.js';

/**
 *
 */
export function useSpinIndex(): number {
  const [idx, setIdx] = useState<number>(getCurrentSpinIndex());
  useEffect(() => {
    // Sync to the live value immediately on mount, before subscribing,
    // so a late tick can't make us flash a stale glyph.
    setIdx(getCurrentSpinIndex());
    return subscribeSpin(setIdx);
  }, []);
  return idx;
}
