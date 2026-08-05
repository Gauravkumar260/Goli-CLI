/**
 * state/useAppState.ts — React hook for AppStateStore subscription.
 *
 * P1-24 fix: Migrated from `useState` + `useEffect` to React 18's
 * `useSyncExternalStore`. The previous implementation could TEAR under
 * React 18 concurrent rendering — a component reading
 * `AppStateStore.getSnapshot()` directly while a re-render was in
 * progress could see a different snapshot than `useAppState()` returned,
 * because `useState`'s initial value was captured once at mount and
 * updates only arrived via the subscription effect.
 *
 * `useSyncExternalStore` is the React-recommended primitive for
 * subscribing to external (non-React) stores. It guarantees:
 *   - No tearing: all reads in a single render pass return the same value.
 *   - Synchronous snapshot: `getSnapshot` is called on every render so
 *     the component always sees the latest state.
 *   - No `useEffect` for subscription (cleaner, fewer re-renders).
 *
 * Note: `useSyncExternalStore` requires that `getSnapshot` returns a
 * referentially-stable value when nothing has changed (otherwise it
 * loops infinitely). `AppStateStore.getSnapshot` returns the live
 * `this.snap` reference, which only changes when `patch()` / `addUsage()`
 * / etc. create a new snapshot via spread — so this is safe.
 */
import { useSyncExternalStore } from 'react';
import { AppStateStore } from './AppStateStore.js';
import type { AppStateSnapshot } from './types.js';

/**
 * Subscribe to AppStateStore and re-render on snapshot changes.
 * Returns the current AppStateSnapshot.
 */
export function useAppState(): AppStateSnapshot {
  return useSyncExternalStore(
    AppStateStore.subscribe.bind(AppStateStore),
    AppStateStore.getSnapshot.bind(AppStateStore),
    // Server snapshot — for SSR (not used in TUI, but required by the
    // type signature). Returns the same client snapshot.
    AppStateStore.getSnapshot.bind(AppStateStore),
  );
}
