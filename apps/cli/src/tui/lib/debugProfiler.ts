/**
 * lib/debugProfiler.ts — Frame + idle-frame + action-timestamp profiler.
 *
 * Mirrors gemini-cli's `DebugProfiler` singleton pattern, but built on
 * goli's existing `CircularBuffer` (no `mnemonist` dependency).
 *
 * What it tracks:
 *   - `numFrames` — every React commit (when a profiler is mounted).
 *   - `totalIdleFrames` — frames rendered >500ms after the last user
 *     action (a symptom of infinite re-render loops).
 *   - `totalFlickerFrames` — frames taller than the terminal (from
 *     `flickerStore.recordFlickerFrame`).
 *   - `actionTimestamps` — sliding window of recent action timestamps,
 *     used to decide whether a frame was "idle".
 *
 * Activation: GOLI_TUI_DEBUG=1. Off by default; the singleton is a no-op.
 *
 * @module debugProfiler
 */

import { CircularBuffer } from './circularBuffer.js';
import { recordFlickerFrame, onFlicker, isFlickerEnabled } from './flickerStore.js';

const ENABLED = process.env['GOLI_TUI_DEBUG'] === '1';

/** Frames rendered at least this far from an action are considered idle. */
export const MIN_TIME_FROM_ACTION_TO_BE_IDLE = 500;

/** Max action timestamps to keep (sliding window). */
export const ACTION_TIMESTAMP_CAPACITY = 2048;

/** Max frame timestamps to keep (sliding window). */
export const FRAME_TIMESTAMP_CAPACITY = 2048;

/** Idle-frame threshold in a 1-second window that triggers an alert. */
export const IDLE_FRAME_ALERT_THRESHOLD = 5;

/** Public snapshot of profiler state. */
export interface ProfilerSnapshot {
  /** Whether any DebugProfiler component is currently mounted. */
  profilersActive: number;
  /** Total frames rendered while at least one profiler was mounted. */
  numFrames: number;
  /** Frames rendered >500ms from any action. */
  totalIdleFrames: number;
  /** Frames taller than the terminal height. */
  totalFlickerFrames: number;
  /** Whether the first-flicker warning has already been logged. */
  hasLoggedFirstFlicker: boolean;
  /** Timestamp (ms) of the most recent frame start. */
  lastFrameStartTime: number;
  /** Timestamp (ms) of the most recent action. */
  lastActionTimestamp: number;
}

/**
 * The profiler singleton. Tests access fields directly; production code
 * uses the methods. The shape mirrors gemini-cli's `profiler` export
 * so the port surface stays 1:1.
 */
export const profiler = {
  profilersActive: 0,
  numFrames: 0,
  totalIdleFrames: 0,
  totalFlickerFrames: 0,
  hasLoggedFirstFlicker: false,
  lastFrameStartTime: 0,
  openedDebugConsole: false,
  lastActionTimestamp: 0,

  possiblyIdleFrameTimestamps: new CircularBuffer<number>(FRAME_TIMESTAMP_CAPACITY),
  actionTimestamps: new CircularBuffer<number>(ACTION_TIMESTAMP_CAPACITY),

  /** Reset all counters. Used by tests and `/profile reset`. */
  reset(): void {
    this.profilersActive = 0;
    this.numFrames = 0;
    this.totalIdleFrames = 0;
    this.totalFlickerFrames = 0;
    this.hasLoggedFirstFlicker = false;
    this.lastFrameStartTime = 0;
    this.openedDebugConsole = false;
    this.lastActionTimestamp = 0;
    this.possiblyIdleFrameTimestamps.clear();
    this.actionTimestamps.clear();
  },

  /** Record a user/system action (keypress, resize, tool event, etc.). */
  reportAction(): void {
    if (!ENABLED) return;
    const now = Date.now();
    if (now - this.lastActionTimestamp > 16) {
      this.actionTimestamps.push(now);
      this.lastActionTimestamp = now;
    }
  },

  /** Record a frame render. Called from the DebugProfiler component. */
  reportFrameRendered(): void {
    if (!ENABLED) return;
    if (this.profilersActive === 0) return;
    const now = Date.now();
    this.lastFrameStartTime = now;
    this.numFrames++;
    // We don't track "animated components" the way gemini does; treat all
    // frames as possibly-idle candidates. checkForIdleFrames() will classify
    // them based on action proximity.
    this.possiblyIdleFrameTimestamps.push(now);
  },

  /**
   * Classify old possibly-idle frames as idle or not, based on action proximity.
   * Should be called periodically (e.g. once per second).
   */
  checkForIdleFrames(): void {
    if (!ENABLED) return;
    const now = Date.now();
    const judgementCutoff = now - MIN_TIME_FROM_ACTION_TO_BE_IDLE;
    const oneSecondIntervalFromJudgementCutoff = judgementCutoff - 1000;

    let idleInPastSecond = 0;
    const stillIdle: number[] = [];

    // Drain and classify
    const frames = this.possiblyIdleFrameTimestamps.drain();
    for (const frameTime of frames) {
      if (frameTime > judgementCutoff) {
        // Too recent to judge — keep for next pass
        stillIdle.push(frameTime);
        continue;
      }
      const start = frameTime - MIN_TIME_FROM_ACTION_TO_BE_IDLE;
      const end = frameTime + MIN_TIME_FROM_ACTION_TO_BE_IDLE;

      // Drain action timestamps older than `start` (they can't affect future frames)
      const actions = this.actionTimestamps.drain();
      const keptActions: number[] = [];
      let hasAction = false;
      for (const a of actions) {
        if (a < start) continue; // too old
        if (a <= end) {
          hasAction = true;
          keptActions.push(a);
        } else {
          keptActions.push(a); // future action, keep
        }
      }
      // Restore kept actions
      for (const a of keptActions) this.actionTimestamps.push(a);

      if (!hasAction) {
        if (frameTime >= oneSecondIntervalFromJudgementCutoff) {
          idleInPastSecond++;
        }
        this.totalIdleFrames++;
      }
    }

    // Restore frames too recent to judge
    for (const f of stillIdle) this.possiblyIdleFrameTimestamps.push(f);

    if (idleInPastSecond >= IDLE_FRAME_ALERT_THRESHOLD) {
      // The "open debug console" side-effect is delegated to the host app;
      // we only flag it here. Hosts can poll `profiler.openedDebugConsole`.
      this.openedDebugConsole = true;
    }
  },

  /** Increment the flicker-frame counter. Called when a flicker event fires. */
  reportFlicker(): void {
    if (!ENABLED) return;
    this.totalFlickerFrames++;
    this.reportAction();
    if (!this.hasLoggedFirstFlicker) {
      this.hasLoggedFirstFlicker = true;
      // The actual logging is delegated to the host (debugLogger); we just
      // record state so the host can decide whether to print.
    }
  },

  /** Take a snapshot for display / testing. */
  snapshot(): ProfilerSnapshot {
    return {
      profilersActive: this.profilersActive,
      numFrames: this.numFrames,
      totalIdleFrames: this.totalIdleFrames,
      totalFlickerFrames: this.totalFlickerFrames,
      hasLoggedFirstFlicker: this.hasLoggedFirstFlicker,
      lastFrameStartTime: this.lastFrameStartTime,
      lastActionTimestamp: this.lastActionTimestamp,
    };
  },
};

/**
 * Wire the profiler to the flicker store. Call this once at app startup.
 * Returns an unsubscribe function.
 */
export function wireFlickerToProfiler(): () => void {
  if (!ENABLED || !isFlickerEnabled()) return () => undefined;
  return onFlicker(() => {
    profiler.reportFlicker();
    // Also record the flicker in the profiler's own counter for the snapshot.
    // (recordFlickerFrame in flickerStore already increments ITS counter;
    // the profiler keeps its own for display in the DebugProfiler overlay.)
  });
}

/**
 * Convenience: record a flicker frame from anywhere. Delegates to flickerStore.
 * The profiler's own `reportFlicker` is called via the wireFlickerToProfiler
 * subscription, so both counters stay in sync.
 */
export function recordFlicker(): void {
  if (!ENABLED) return;
  recordFlickerFrame();
}
