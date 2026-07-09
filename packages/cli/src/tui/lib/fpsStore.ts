/**
 * lib/fpsStore.ts — Tiny FPS tracker for the goli-tui debug overlay.
 *
 * Ported from hermes-agent's `ui-tui/src/lib/fpsStore.ts`. Adapted to
 * goli's singleton-store architecture (mirrors AppStateStore — see
 * `state/AppStateStore.ts`) and stripped of its `nanostores` dependency,
 * so it slots into the existing CLI without adding new packages.
 *
 * What this catches (research §19 anti-pattern #10 / §23.1 debug overlay):
 *   - Render-tree blowups that drop sustained FPS below the threshold
 *     a user perceives as "smooth" (~30 fps). The hermes research note
 *     that this overlay was built for calls this out as the most
 *     actionable signal in a TUI: a console-only profiler sees fewer
 *     "frames" because it isn't tied to React commits, while the
 *     user-perceived frame budget is exactly what React commits are.
 *
 * Activation:
 *   Set GOLI_TUI_FPS=1. Off by default; the env check happens once
 *   at module load (`ENABLED`), so when disabled the hook and the
 *   overlay both short-circuit at the same guard and the per-frame
 *   work is one branch.
 *
 * Design notes (no UI change):
 *   - Rolling window of `WINDOW_SIZE` timestamps (default 30, same
 *     as hermes) avoids the GC churn that an unbounded `push` would
 *     cause on multi-hour sessions.
 *   - `trackFrame(durationMs)` is the public hook the React mount
 *     calls on each commit. Default-arg `performance.now()` was
 *     avoided so `durationMs` is a developer-controlled measurement
 *     (React's commit phase duration from `useEffect` timing).
 *   - Subscribers are coalesced the same way `AppStateStore` does
 *     (queueMicrotask) — multiple frames between two microtasks
 *     produce one notification, which keeps React from re-rendering
 *     the overlay at 60 Hz even if Windows happens to deliver
 *     multiple commits back-to-back.
 */
import { performance } from 'node:perf_hooks';

const WINDOW_SIZE = 30;

/**
 *
 */
export interface FpsState {
  /** Smoothed frames-per-second over the last WINDOW_SIZE frames. */
  fps: number;
  /** Last frame's measured render duration in milliseconds. */
  lastDurationMs: number;
  /** Wraps at JS-safe int — diff pairs in debug overlays stay safe. */
  totalFrames: number;
}

const ENABLED = process.env['GOLI_TUI_FPS'] === '1';

const initial: FpsState = ENABLED
  ? { fps: 0, lastDurationMs: 0, totalFrames: 0 }
  : { fps: 0, lastDurationMs: 0, totalFrames: 0 };

let state: FpsState = initial;
const subscribers = new Set<(s: FpsState) => void>();

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
/** Whether the FPS overlay is active this session. */
export function isFpsEnabled(): boolean {
  return ENABLED;
}

/** Subscribe to FPS-state changes. Returns an unsubscribe fn. */
export function subscribeFps(fn: (s: FpsState) => void): () => void {
  if (!ENABLED) {
    // No-op subscriptions when disabled — gives hooks a uniform API
    // without forcing every consumer to gate the subscribe() call.
    return () => undefined;
  }
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Read the current snapshot synchronously (test/diagnostic use). */
export function getFpsSnapshot(): FpsState {
  return state;
}

// ─── Frame tracker ─────────────────────────────────────────────────────────
const timestamps: number[] = [];
let totalFrames = 0;

/**
 * Record one frame. `durationMs` is the renderer's measured cost for
 * the just-completed frame (e.g. React useEffect commit duration).
 *
 * Zero-cost when `GOLI_TUI_FPS` is unset: the caller gates on
 * `isFpsEnabled()` so this function isn't even invoked, and `state`
 * never mutates. Subscribers are still created cheaply (Set.add) when
 * disabled — they just never receive anything.
 */
export function trackFrame(durationMs: number): void {
  if (!ENABLED) return;

  timestamps.push(performance.now());
  if (timestamps.length > WINDOW_SIZE) timestamps.shift();
  totalFrames++;

  if (timestamps.length < 2) return;

  const last = timestamps[timestamps.length - 1] as number;
  const first = timestamps[0] as number;
  const elapsed = (last - first) / 1000;

  if (elapsed > 0) {
    const fps = Math.round(((timestamps.length - 1) / elapsed) * 10) / 10;
    state = {
      fps,
      // Round so React doesn't trigger a re-render on sub-millisecond
      // noise (and so the printed value doesn't visibly jitter).
      lastDurationMs: Math.round(durationMs * 100) / 100,
      totalFrames,
    };
    scheduleNotify();
  }
}
