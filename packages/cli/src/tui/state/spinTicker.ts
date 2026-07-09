/**
 * state/spinTicker.ts — Shared spinner ticker.
 *
 * Avoids re-rendering the whole App on every spinner tick. Each
 * subscriber gets a fresh spinIndex whenever the global interval
 * fires. Components subscribe via React useState + manual cleanup.
 *
 * Why not React Context? Context changes still re-render consumers,
 * but a hook-based subscription with selective state update only
 * re-renders the hook's component, not its siblings.
 *
 * Research-driven improvements (no design change):
 *   - Interval is 80ms (the proven standard — every major tool uses
 *     this exact rate; previously 100ms).
 *   - 200ms delay before the ticker starts. Operations under 200ms
 *     appear instant — showing a spinner for sub-200ms ops makes the
 *     UI feel "throbby". (Research §7.1 Law 4 + §17.1 P0 #2.)
 *   - Animation throttling on SSH / accessibility mode (research §16.3):
 *     on SSH we slow the ticker to 200ms to avoid the "fast animations
 *     look wrong over SSH latency" effect.
 *   - Self-stops when no subscribers — saves CPU/battery when idle.
 *     (Previously the ticker kept running even with no listeners; this
 *     was already correct, just made explicit + audited.)
 */
import { SPIN } from '../theme/agents.js';
import { detectCapabilities, shouldThrottleAnimations } from '../lib/capabilities.js';

type Listener = (idx: number) => void;

/** Standard 80ms interval (research §17.3 "Braille spinner (standard)"). */
const SPINNER_INTERVAL_MS = 80;

/** Slower interval for SSH / accessibility (research §16.3). */
const SPINNER_INTERVAL_MS_THROTTLED = 200;

/**
 * 200ms visibility delay (research §7.1 Law 4: "200ms is the visibility
 * threshold"). Operations completing under 200ms should appear instant.
 */
const SPINNER_DELAY_MS = 200;

let currentIdx = 0;
const listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;

function intervalMs(): number {
  return shouldThrottleAnimations() ? SPINNER_INTERVAL_MS_THROTTLED : SPINNER_INTERVAL_MS;
}

function ensureRunning(): void {
  if (intervalId) return;
  if (startTimer) return;  // already scheduled to start

  // 200ms delay before first tick — eliminates "flash" on fast ops.
  // (Research §7.1 Law 4 + §17.1 P0 #2.)
  startTimer = setTimeout(() => {
    startTimer = null;
    if (listeners.size === 0) return;  // everyone unsubscribed during the delay
    intervalId = setInterval(() => {
      currentIdx = (currentIdx + 1) % SPIN.length;
      for (const fn of listeners) fn(currentIdx);
    }, intervalMs());
  }, SPINNER_DELAY_MS);

  // Don't keep the process alive just for the start delay.
  if (startTimer && typeof startTimer.unref === 'function') {
    startTimer.unref();
  }
}

function maybeStop(): void {
  if (listeners.size === 0) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
  }
}

/**
 *
 */
export function subscribeSpin(fn: Listener): () => void {
  listeners.add(fn);
  ensureRunning();
  return () => {
    listeners.delete(fn);
    maybeStop();
  };
}

/**
 *
 */
export function getCurrentSpinIndex(): number {
  return currentIdx;
}

/**
 * Returns the configured spinner interval in milliseconds. Useful for
 * tests and the debug overlay.
 */
export function getSpinnerIntervalMs(): number {
  return intervalMs();
}

/**
 * Returns the configured spinner delay (visibility threshold) in
 * milliseconds. Useful for tests and the debug overlay.
 */
export function getSpinnerDelayMs(): number {
  return SPINNER_DELAY_MS;
}

// Re-export for components that want to check capabilities directly.
/**
 *
 */
export { detectCapabilities };
