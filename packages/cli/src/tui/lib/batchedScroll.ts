/**
 * lib/batchedScroll.ts — Coalesce same-tick scroll-into-view calls.
 *
 * When multiple parts of the TUI call `scrollIntoView()` in the same
 * event-loop tick (e.g. a tool result + a status update + a new message),
 * each call would individually trigger a re-render of the scroll
 * container. This helper batches them into a single update.
 *
 * Pattern:
 *   - `scheduleScrollTop(value)` — record the latest desired scrollTop.
 *   - At the end of the current microtask, the latest value is flushed
 *     to the registered setter, and only ONE re-render occurs.
 *
 * Activation: always on (the batching is cheap; the cost is one
 * queueMicrotask per tick). When no setter is registered, calls are
 * no-ops.
 *
 * @module batchedScroll
 */

type ScrollSetter = (scrollTop: number) => void;

let pendingScrollTop: number | null = null;
let flushScheduled = false;
let activeSetter: ScrollSetter | null = null;

/**
 * Register the active scroll setter. Only one setter can be active at a
 * time (the most recently registered wins). Returns an unregister fn.
 *
 * Typically called from the scroll container's `useEffect`:
 *   useEffect(() => registerScrollSetter(setScrollTop), []);
 */
export function registerScrollSetter(setter: ScrollSetter): () => void {
  activeSetter = setter;
  return () => {
    if (activeSetter === setter) {
      activeSetter = null;
    }
  };
}

/**
 * Schedule a scrollTop update. The latest value wins; only one flush
 * occurs per microtask, regardless of how many times this is called.
 *
 * If no setter is registered, the call is a no-op.
 */
export function scheduleScrollTop(value: number): void {
  if (!activeSetter) return;
  pendingScrollTop = value;
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    if (pendingScrollTop === null || !activeSetter) return;
    const v = pendingScrollTop;
    pendingScrollTop = null;
    activeSetter(v);
  });
}

/**
 * Flush any pending scroll update immediately. Useful before a synchronous
 * operation that needs the scroll position to be settled.
 */
export function flushPendingScroll(): void {
  if (pendingScrollTop === null || !activeSetter) return;
  const v = pendingScrollTop;
  pendingScrollTop = null;
  flushScheduled = false;
  activeSetter(v);
}

/**
 * Reset all batched-scroll state. Used by tests to isolate cases.
 */
export function resetBatchedScroll(): void {
  pendingScrollTop = null;
  flushScheduled = false;
  activeSetter = null;
}

/**
 * Read the current pending value (test/diagnostic use). Returns null if
 * no scroll is pending.
 */
export function getPendingScrollTop(): number | null {
  return pendingScrollTop;
}
