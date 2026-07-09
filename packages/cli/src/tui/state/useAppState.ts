/**
 * state/useAppState.ts — React hook for AppStateStore subscription.
 */
import { useEffect, useState } from 'react';
import { AppStateStore } from './AppStateStore.js';
import type { AppStateSnapshot } from './types.js';

/**
 *
 */
export function useAppState(): AppStateSnapshot {
  const [snap, setSnap] = useState<AppStateSnapshot>(AppStateStore.getSnapshot());
  useEffect(() => {
    const unsub = AppStateStore.subscribe((s) => setSnap(s));
    return unsub;
  }, []);
  return snap;
}
