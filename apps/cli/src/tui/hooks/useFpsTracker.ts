/**
 * hooks/useFpsTracker.ts — Per-frame render-time sampler.
 *
 * Wired from a top-level component (e.g. inside <App />). Schedules a
 * tick via `setImmediate` (Node's process.nextTick sibling — runs at
 * the tail of each poll phase, ~as fast as idle V8 allows) and
 * measures the wall-clock interval between ticks. The interval feeds
 * `trackFrame()`, which produces a smoothed `fps` reading.
 *
 * Why setImmediate instead of `requestAnimationFrame`?
 *   goli-cli ships against `lib: ["ESNext"]` + `types: ["node"]`
 *   (see `apps/cli/tsconfig.json`) — there is no DOM ambient,
 *   so `requestAnimationFrame` doesn't exist. Hermes's equivalent
 *   file used rAF only because `@hermes/ink` ships a rAF shim. The
 *   semantically important property is "measure the gap between two
 *   well-defined scheduling points and feed it to a FPS estimator" —
 *   both APIs deliver that, just at different cadences. setImmediate
 *   actually fires *more often* than rAF on an idle Node process,
 *   which is fine: WINDOW_SIZE=30 still averages correctly.
 *
 * Off by default (no work when `GOLI_TUI_FPS` is unset). When on,
 * the cost is one `setImmediate` per Node event-loop tick + one
 * `performance.now()` call; ~negligible next to a single Ink render.
 */
import { useEffect } from 'react';
import { isFpsEnabled, trackFrame } from '../lib/fpsStore.js';

/**
 *
 */
export function useFpsTracker(): void {
  useEffect(() => {
    if (!isFpsEnabled()) return;

    let cancelled = false;
    let handle: NodeJS.Immediate | null = null;
    let lastTick = performance.now();

    const tick = (): void => {
      if (cancelled) return;
      const now = performance.now();
      const intervalMs = now - lastTick;
      lastTick = now;
      // `trackFrame` accepts the just-completed frame's render duration.
      // In this hook the only window we have is "time since the last
      // tick" — that's the user-perceived frame interval and is also
      // what the FPS number is computed against.
      trackFrame(intervalMs);
      handle = setImmediate(tick);
    };

    handle = setImmediate(tick);

    return () => {
      cancelled = true;
      if (handle !== null) clearImmediate(handle);
    };
  }, []);
}
