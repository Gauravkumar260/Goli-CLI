/**
 * lib/flickerStore.ts — Flicker-frame counter and event bus.
 *
 * A "flicker frame" is a React commit whose rendered tree is TALLER than
 * the terminal height — a rendering bug that causes the terminal to scroll
 * vertically on every commit, producing a visible flicker.
 *
 * This store is the single source of truth for flicker-frame count. It is:
 *   - Zero-cost when GOLI_TUI_DEBUG is unset (the hook short-circuits).
 *   - Subscription-based (mirrors fpsStore's pattern).
 *   - Testable: the public surface is synchronous + deterministic.
 *
 * Activation: set GOLI_TUI_DEBUG=1. Off by default.
 *
 * @module flickerStore
 */

const ENABLED = process.env['GOLI_TUI_DEBUG'] === '1';

/** Snapshot of flicker state. */
export interface FlickerState {
  /** Total flicker frames detected this session. */
  totalFlickerFrames: number;
  /** Timestamp (ms since epoch) of the most recent flicker. 0 if none. */
  lastFlickerAt: number;
  /** Whether the detector is enabled this session. */
  enabled: boolean;
}

const initial: FlickerState = {
  totalFlickerFrames: 0,
  lastFlickerAt: 0,
  enabled: ENABLED,
};

let state: FlickerState = initial;
const subscribers = new Set<(s: FlickerState) => void>();
const flickerHandlers = new Set<() => void>();

let notifyScheduled = false;
function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    if (subscribers.size === 0) return;
    for (const fn of subscribers) fn(state);
  });
}

// ─── Public surface ────────────────────────────────────────────────────────

/** Whether the flicker detector is active this session. */
export function isFlickerEnabled(): boolean {
  return ENABLED;
}

/** Subscribe to flicker-state changes. Returns an unsubscribe fn. */
export function subscribeFlicker(fn: (s: FlickerState) => void): () => void {
  if (!ENABLED) return () => undefined;
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Register a callback for the next flicker event. Returns an unsubscribe fn. */
export function onFlicker(fn: () => void): () => void {
  if (!ENABLED) return () => undefined;
  flickerHandlers.add(fn);
  return () => {
    flickerHandlers.delete(fn);
  };
}

/** Read the current snapshot synchronously (test/diagnostic use). */
export function getFlickerSnapshot(): FlickerState {
  return state;
}

/**
 * Record one flicker frame. Increments the counter, updates the timestamp,
 * notifies subscribers, and emits the flicker event to all registered handlers.
 *
 * Zero-cost when GOLI_TUI_DEBUG is unset.
 */
export function recordFlickerFrame(): void {
  if (!ENABLED) return;
  const now = Date.now();
  state = {
    ...state,
    totalFlickerFrames: state.totalFlickerFrames + 1,
    lastFlickerAt: now,
  };
  scheduleNotify();
  for (const fn of flickerHandlers) {
    try {
      fn();
    } catch {
      // Handler errors must not crash the render loop.
    }
  }
}

/**
 * Reset the flicker counter. Used by tests and by `/profile reset`.
 * Does NOT affect the enabled flag.
 */
export function resetFlickerState(): void {
  state = { ...initial, enabled: ENABLED };
  scheduleNotify();
}
