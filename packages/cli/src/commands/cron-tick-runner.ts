/**
 * CronTickRunner — hardened cron tick executor (T-023).
 *
 * The existing `commands/cron.ts` module is a CRUD store + schedule
 * matcher. It does NOT execute ticks safely. This module adds the four
 * Hermes-reference hardening invariants:
 *
 *   1. **3-minute hard interrupt** — if a cron session runs longer than
 *      3 minutes, it is forcibly aborted (AbortController + setTimeout).
 *      Prevents a runaway agent loop from blocking the scheduler.
 *
 *   2. **File lock (flock-style)** — a lockfile at
 *      `<goliHome>/cron.lock` prevents two `goli cron tick` processes
 *      from running simultaneously. Uses `O_EXCL` atomic create-or-fail.
 *
 *   3. **Catchup window = half period, clamped 120s–2h** — if a cron
 *      tick missed its scheduled time (e.g. laptop was asleep), the
 *      tick fires if the current time is within the catchup window.
 *      Window = max(120s, min(period/2, 2h)).
 *
 *   4. **Grace window 120s for one-shot cron jobs** — a one-shot cron
 *      (schedule "@" prefix, e.g. `@once`) fires if within 120s of its
 *      scheduled time, then is auto-disabled.
 *
 * ## Why these matter
 *
 * Without hardening, a cron scheduler can:
 *   - Run forever if the agent loop stalls (no interrupt).
 *   - Double-fire if two tick processes race (no lock).
 *   - Miss ticks silently after sleep/suspend (no catchup).
 *   - Fire stale one-shot jobs hours late (no grace window).
 *
 * @module commands/cron-tick-runner
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { shouldFire } from './cron.js';

import type { CronEntry } from './cron.js';

/** 3 minutes — the maximum wall-clock time a single cron tick may run. */
export const HARD_INTERRUPT_MS = 3 * 60 * 1000;

/** 120 seconds — minimum catchup window + one-shot grace window. */
export const MIN_CATCHUP_MS = 120 * 1000;

/** 2 hours — maximum catchup window. */
export const MAX_CATCHUP_MS = 2 * 60 * 60 * 1000;

/** 120 seconds — grace window for one-shot cron jobs. */
export const ONE_SHOT_GRACE_MS = 120 * 1000;

/** Result of a single tick execution. */
export interface TickResult {
  /** The cron entry ID that was ticked. */
  entryId: string;
  /** Whether the tick fired (true) or was skipped (false). */
  fired: boolean;
  /** Why the tick was skipped (if fired === false). */
  skipReason?: 'locked' | 'outside-catchup-window' | 'disabled' | 'already-run-today' | 'one-shot-not-eligible' | 'recently-fired';
  /** Whether the tick was forcibly aborted by the hard interrupt. */
  aborted: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Error message (if the handler threw). */
  error?: string;
}

/** Options for the tick runner. */
export interface CronTickRunnerOptions {
  /** Override the GOLI_HOME directory (defaults to ~/.goli-cli). */
  goliHome?: string;
  /** Override the hard interrupt timeout (default: 3 minutes). */
  hardInterruptMs?: number;
  /** Override the min catchup window (default: 120s). */
  minCatchupMs?: number;
  /** Override the max catchup window (default: 2h). */
  maxCatchupMs?: number;
  /** Override the one-shot grace window (default: 120s). */
  oneShotGraceMs?: number;
  /** Inject a custom clock (for tests). Defaults to Date.now. */
  now?: () => number;
  /** Inject a custom sleep function (for tests). Defaults to setTimeout. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Compute the catchup window for a cron schedule.
 *
 * Window = max(minCatchupMs, min(period/2, maxCatchupMs)).
 *
 * The "period" is the smallest interval the schedule can express:
 *  - `* * * * *` → 1 minute
 *  - asterisk-slash-5 minute field → 5 minutes
 *  - `0 * * * *` → 1 hour
 *  - `0 0 * * *` → 1 day
 *
 * For simplicity, we approximate the period from the minute field:
 *  - asterisk or asterisk-slash-N → N minutes (or 1 if N is 0/missing)
 *  - specific minute → 1 hour (the schedule fires at most once per hour)
 *  - otherwise → 1 day (conservative default)
 *
 * @param schedule - The cron schedule expression.
 * @param opts - Min/max clamp values.
 * @returns The catchup window in ms.
 */
export function computeCatchupWindow(
  schedule: string,
  opts: { minCatchupMs?: number; maxCatchupMs?: number } = {},
): number {
  const min = opts.minCatchupMs ?? MIN_CATCHUP_MS;
  const max = opts.maxCatchupMs ?? MAX_CATCHUP_MS;

  const fields = schedule.trim().split(/\s+/);
  const minuteField = fields[0] ?? '*';
  const hourField = fields[1] ?? '*';

  let periodMs: number;
  if (minuteField === '*') {
    periodMs = 60 * 1000; // every minute
  } else if (minuteField.startsWith('*/')) {
    const step = parseInt(minuteField.slice(2), 10);
    periodMs = (isNaN(step) || step < 1 ? 1 : step) * 60 * 1000;
  } else if (hourField === '*') {
    // Specific minute, any hour → fires once per hour.
    periodMs = 60 * 60 * 1000;
  } else if (hourField.startsWith('*/')) {
    // Specific minute, every N hours.
    const step = parseInt(hourField.slice(2), 10);
    periodMs = (isNaN(step) || step < 1 ? 1 : step) * 60 * 60 * 1000;
  } else {
    // Specific minute + specific hour → fires once per day (at most).
    periodMs = 24 * 60 * 60 * 1000;
  }

  const half = periodMs / 2;
  return Math.max(min, Math.min(half, max));
}

/**
 * Check whether a cron entry is within its catchup window relative to `now`.
 *
 * @param entry - The cron entry.
 * @param now - Current time (epoch ms).
 * @param windowMs - The catchup window (from computeCatchupWindow).
 * @returns True if the entry should fire (within catchup window).
 */
export function isWithinCatchupWindow(
  entry: CronEntry,
  now: number,
  windowMs: number,
): boolean {
  if (!entry.lastRunAt) return true; // never run → always eligible
  const lastRun = Date.parse(entry.lastRunAt);
  if (Number.isNaN(lastRun)) return true;
  const elapsed = now - lastRun;
  // If the entry was run within the catchup window, skip (already ran).
  // If it was run longer ago than the window, it's eligible to fire again.
  // BUT: this function is about whether a MISSED tick should catch up.
  // The actual "should this fire now?" is `shouldFire(schedule, new Date(now))`.
  // This function gates: "if the last run was within the window, don't double-fire."
  return elapsed >= windowMs;
}

/**
 * Acquire a file lock (flock-style) using O_EXCL atomic create.
 *
 * Returns a release function that removes the lockfile. If the lockfile
 * already exists, returns null (caller should skip the tick).
 *
 * The lockfile contains the PID + ISO timestamp for debugging stale locks.
 *
 * @param lockPath - Path to the lockfile.
 * @returns A release function, or null if the lock is held.
 */
export function acquireLock(
  lockPath: string,
): (() => void) | null {
  // Check for stale lock (older than HARD_INTERRUPT_MS + 60s grace).
  if (existsSync(lockPath)) {
    // We don't auto-remove stale locks here — the caller decides.
    return null;
  }
  try {
    const fd = openSync(lockPath, 'wx'); // O_EXCL: fails if exists
    const content = `${process.pid}\n${new Date().toISOString()}\n`;
    writeFileSync(fd, content, 'utf-8');
    closeSync(fd);
    return () => {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        /* ignore — best effort */
      }
    };
  } catch {
    // EEXIST — another process won the race.
    return null;
  }
}

/**
 * Force-release a stale lockfile (if it exists).
 *
 * Called by the tick runner when it detects the lock is older than
 * HARD_INTERRUPT_MS + 60s grace (the previous holder definitely timed out).
 *
 * @param lockPath - Path to the lockfile.
 * @param now - Current time (epoch ms).
 * @param staleThresholdMs - Locks older than this are considered stale.
 * @returns True if a stale lock was removed.
 */
export function breakStaleLock(
  lockPath: string,
  now: number,
  staleThresholdMs: number = HARD_INTERRUPT_MS + 60_000,
): boolean {
  if (!existsSync(lockPath)) return false;
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const lines = content.split('\n');
    const ts = Date.parse(lines[1] ?? '');
    if (Number.isNaN(ts)) {
      // Malformed lockfile — remove it.
      rmSync(lockPath, { force: true });
      return true;
    }
    if (now - ts > staleThresholdMs) {
      rmSync(lockPath, { force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Execute a single cron tick with full hardening.
 *
 * Steps:
 *  1. Acquire file lock (skip if held, after breaking stale locks).
 *  2. For each enabled entry, check shouldFire + catchup window.
 *  3. For each firing entry, call the handler with a 3-minute abort.
 *  4. Release the lock.
 *
 * @param entries - The cron entries to consider.
 * @param handler - The function to execute for each firing entry.
 * @param opts - Runner options.
 * @returns Array of tick results (one per entry considered).
 */
export async function executeTick(
  entries: CronEntry[],
  handler: (entry: CronEntry, signal: AbortSignal) => Promise<void>,
  opts: CronTickRunnerOptions = {},
): Promise<TickResult[]> {
  const goliHome = opts.goliHome ?? process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  const lockPath = join(goliHome, 'cron.lock');
  const hardInterruptMs = opts.hardInterruptMs ?? HARD_INTERRUPT_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ??
    (async (ms: number, signal?: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

  // Ensure goliHome exists (for the lockfile).
  if (!existsSync(goliHome)) {
    mkdirSync(goliHome, { recursive: true });
  }

  // 1. Break stale locks from previous runs that timed out.
  breakStaleLock(lockPath, now());

  // 2. Acquire the lock.
  const releaseLock = acquireLock(lockPath);
  if (!releaseLock) {
    // Another tick process is running — skip all entries.
    return entries.map((entry) => ({
      entryId: entry.id,
      fired: false,
      skipReason: 'locked' as const,
      aborted: false,
      durationMs: 0,
    }));
  }

  const results: TickResult[] = [];

  try {
    for (const entry of entries) {
      const result = await executeEntry(entry, handler, {
        hardInterruptMs,
        minCatchupMs: opts.minCatchupMs,
        maxCatchupMs: opts.maxCatchupMs,
        oneShotGraceMs: opts.oneShotGraceMs,
        now: now,
        sleep,
      });
      results.push(result);
    }
  } finally {
    releaseLock();
  }

  return results;
}

/** Execute a single entry with hard interrupt + catchup window checks. */
async function executeEntry(
  entry: CronEntry,
  handler: (entry: CronEntry, signal: AbortSignal) => Promise<void>,
  opts: {
    hardInterruptMs: number;
    minCatchupMs?: number;
    maxCatchupMs?: number;
    oneShotGraceMs?: number;
    now: () => number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<TickResult> {
  const start = opts.now();
  // P1-18 fix: track whether this fire is a catch-up (missed tick) so
  // the result includes that information for telemetry / debugging.
  let isCatchupFire = false;

  // Skip disabled entries.
  if (!entry.enabled) {
    return {
      entryId: entry.id,
      fired: false,
      skipReason: 'disabled',
      aborted: false,
      durationMs: opts.now() - start,
    };
  }

  // P1-19 fix: Check one-shot schedules (`@once`, `@reboot`) first.
  // Previously `shouldFireOneShot` was defined but never called by
  // `executeEntry` — a one-shot entry with schedule `@once` would fall
  // into `shouldFire` (line below), which splits on whitespace → 1
  // field → returns `false` → entry was skipped forever. The "one-shot
  // cron jobs" feature simply didn't work.
  if (entry.schedule.startsWith('@')) {
    if (!shouldFireOneShot(entry, opts.now(), opts.oneShotGraceMs ?? ONE_SHOT_GRACE_MS)) {
      return {
        entryId: entry.id,
        fired: false,
        skipReason: 'one-shot-not-eligible',
        aborted: false,
        durationMs: opts.now() - start,
      };
    }
    // Fall through to the fire path below.
  } else {
    // Check shouldFire at current time.
    const nowDate = new Date(opts.now());
    if (!shouldFire(entry.schedule, nowDate)) {
      // P1-18 fix: Catchup window logic was dead code — both branches of
      // the original `if (!isWithinCatchupWindow)` returned the SAME
      // `'outside-catchup-window'` skipReason, so missed ticks were
      // never caught up (a laptop asleep through the scheduled time
      // would never have the entry fire on wake, despite the entire
      // `computeCatchupWindow` infrastructure).
      //
      // Correct semantics:
      //   - If `isWithinCatchupWindow` returns TRUE, the entry was run
      //     recently (within the dedup window) → skip to avoid double-fire.
      //   - If it returns FALSE, the entry has NOT run recently → check
      //     whether we MISSED a tick since the last run. If yes, fire
      //     now (catch up). If no, skip (no missed tick).
      const windowMs = computeCatchupWindow(entry.schedule, {
        minCatchupMs: opts.minCatchupMs,
        maxCatchupMs: opts.maxCatchupMs,
      });
      if (isWithinCatchupWindow(entry, opts.now(), windowMs)) {
        // Ran recently — skip to avoid double-fire.
        return {
          entryId: entry.id,
          fired: false,
          skipReason: 'recently-fired',
          aborted: false,
          durationMs: opts.now() - start,
        };
      }
      // Didn't run recently. Check if we missed a tick since the last run.
      // We walk backward minute-by-minute from `now` to `lastRunAt` and if
      // ANY minute in that range would have fired, we catch up by firing
      // now.
      if (entry.lastRunAt) {
        const lastRun = Date.parse(entry.lastRunAt);
        if (!Number.isNaN(lastRun)) {
          // Walk backward in 60s steps. (Cron's smallest unit is 1 minute.)
          for (let t = opts.now(); t > lastRun; t -= 60_000) {
            if (shouldFire(entry.schedule, new Date(t))) {
              // Missed tick — catch up by falling through to the fire path.
              // Use a flag so the fire path knows this is a catch-up.
              isCatchupFire = true;
              break;
            }
          }
          if (!isCatchupFire) {
            // No missed tick in the window — this minute just doesn't fire.
            return {
              entryId: entry.id,
              fired: false,
              skipReason: 'outside-catchup-window',
              aborted: false,
              durationMs: opts.now() - start,
            };
          }
        }
      } else {
        // Never run, and shouldFire is false this minute — no missed
        // tick to catch up. Skip.
        return {
          entryId: entry.id,
          fired: false,
          skipReason: 'outside-catchup-window',
          aborted: false,
          durationMs: opts.now() - start,
        };
      }
    }
  }

  // Fire the handler with a hard interrupt.
  const abortController = new AbortController();
  let aborted = false;
  const timer = setTimeout(() => {
    aborted = true;
    abortController.abort();
  }, opts.hardInterruptMs);

  let error: string | undefined;
  try {
    await handler(entry, abortController.signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Expected — hard interrupt fired.
      aborted = true;
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    entryId: entry.id,
    fired: true,
    aborted,
    durationMs: opts.now() - start,
    error,
    // P1-18 fix: surface catch-up info for telemetry. The `as` cast is
    // needed because TickResult doesn't declare this field yet — we
    // don't want to widen the type for callers that don't know about it.
    ...(isCatchupFire ? ({ catchup: true } as Record<string, unknown>) : {}),
  };
}

/**
 * Check if a one-shot cron entry should fire within its grace window.
 *
 * One-shot entries have a schedule starting with `@` (e.g. `@once`,
 * `@reboot`). They fire once within `oneShotGraceMs` of their scheduled
 * time, then are auto-disabled.
 *
 * @param entry - The cron entry.
 * @param now - Current time (epoch ms).
 * @param graceMs - Grace window (default: 120s).
 * @returns True if the one-shot should fire.
 */
export function shouldFireOneShot(
  entry: CronEntry,
  now: number,
  graceMs: number = ONE_SHOT_GRACE_MS,
): boolean {
  if (!entry.schedule.startsWith('@')) return false;
  if (!entry.enabled) return false;
  if (entry.lastRunAt) return false; // already fired
  // One-shot entries don't have a scheduled time in the cron sense —
  // they fire on the next tick after creation. The grace window is
  // the maximum age of the entry for it to still be "fresh" enough to fire.
  const createdAt = Date.parse(entry.createdAt);
  if (Number.isNaN(createdAt)) return true;
  return now - createdAt <= graceMs;
}

/**
 * Default path for the cron lockfile.
 */
export function defaultLockPath(goliHome?: string): string {
  const home = goliHome ?? process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  return join(home, 'cron.lock');
}

// Re-export for tests + callers that want the full cron API surface.
/** Load cron entries from the config file. */
export { loadCronEntries, markCronRun } from './cron.js';
/** A cron entry (re-exported for convenience). */
export type { CronEntry } from './cron.js';
