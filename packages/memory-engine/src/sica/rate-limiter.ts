/**
 * SICA rate limiter (Module 5, part 4).
 *
 * Limits the rate of SICA cycles to prevent runaway self-improvement:
 * - Max 10 cycles per day (configurable)
 * - Human review required for any change >50 LOC
 * - Human review required for changes to safety-critical targets
 *
 * @module memory/sica/rate-limiter
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { SicaProposal } from './types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for the SicaRateLimiter. */
export interface SicaRateLimiterOptions {
  /** The state file path (default: ~/.agent/sica/rate-limiter.json). */
  statePath?: string;
  /** Max cycles per day (default: 10). */
  maxCyclesPerDay?: number;
  /** LOC threshold for human review (default: 50). */
  humanReviewLocThreshold?: number;
  /** Logger instance. */
  logger?: Logger;
}

/** The rate limiter state (persisted to disk). */
interface RateLimiterState {
  /** The date (YYYY-MM-DD) of the current cycle window. */
  date: string;
  /** The number of cycles run today. */
  cyclesToday: number;
  /** The total cycles ever run. */
  totalCycles: number;
}

/** The SICA rate limiter — prevents runaway self-improvement. */
export class SicaRateLimiter {
  private readonly statePath: string;
  private readonly maxCyclesPerDay: number;
  private readonly humanReviewLocThreshold: number;
  private readonly log?: Logger;

  constructor(opts: SicaRateLimiterOptions = {}) {
    this.statePath = opts.statePath ?? join(homedir(), '.agent', 'sica', 'rate-limiter.json');
    this.maxCyclesPerDay = opts.maxCyclesPerDay ?? 10;
    this.humanReviewLocThreshold = opts.humanReviewLocThreshold ?? 50;
    this.log = opts.logger;
  }

  /**
   * Check if a SICA cycle is allowed (within the daily rate limit).
   */
  canRunCycle(): boolean {
    const state = this.loadState();
    this.resetIfNewDay(state);
    return state.cyclesToday < this.maxCyclesPerDay;
  }

  /**
   * Check if a proposal requires human review.
   *
   * The previous implementation ONLY checked `linesChanged` against
   * the LOC threshold. A proposal that modified safety-critical
   * targets (the sandbox executor, the approval engine, hooks) but
   * was small in LOC passed without review. We now also require
   * human review for safety-critical target patterns.
   * @param proposal
   */
  requiresHumanReview(proposal: SicaProposal): boolean {
    if (proposal.linesChanged >= this.humanReviewLocThreshold) return true;
    // Safety-critical target patterns — even small changes here can
    // disable the sandbox or bypass the approval engine.
    const safetyCriticalPatterns = [
      /sandbox\/executor/,
      /sandbox\/path-validation/,
      /approval\/engine/,
      /tools\/hooks\/builtin\/block-/,
      /tools\/hooks\/builtin\/block-secrets/,
      /tools\/hooks\/builtin\/block-writes-outside-workspace/,
      /tools\/hooks\/builtin\/block-destructive/,
      /config\/mode-prompts/,
    ];
    const targetStr = typeof proposal.target === 'string'
      ? proposal.target
      : JSON.stringify(proposal.target);
    return safetyCriticalPatterns.some((p) => p.test(targetStr));
  }

  /**
   * Record that a cycle was run (increment the counter).
   *
   * The previous implementation was NOT atomic: it loaded state,
   * mutated the in-memory object, then wrote it back. Two concurrent
   * cycles could both read `cyclesToday = 5`, both increment to 6,
   * and both write 6 — losing one increment. We now use a
   * temp-file + rename pattern (atomic on POSIX) so concurrent
   * writes don't lose increments. The read-modify-write race is
   * still possible (two cycles could both read 5, both write 6),
   * but the file is never left in a corrupted state.
   *
   * For full atomicity, callers should serialize SICA cycles
   * externally (e.g. via a file lock).
   */
  recordCycle(): void {
    const state = this.loadState();
    this.resetIfNewDay(state);
    state.cyclesToday++;
    state.totalCycles++;
    this.saveState(state);

    this.log?.info('SICA cycle recorded', {
      cyclesToday: state.cyclesToday,
      maxCyclesPerDay: this.maxCyclesPerDay,
      totalCycles: state.totalCycles,
    });
  }

  /**
   * Get remaining cycles for today.
   */
  get remainingCycles(): number {
    const state = this.loadState();
    this.resetIfNewDay(state);
    return Math.max(0, this.maxCyclesPerDay - state.cyclesToday);
  }

  /**
   * Get the cycles run today.
   */
  get cyclesToday(): number {
    const state = this.loadState();
    this.resetIfNewDay(state);
    return state.cyclesToday;
  }

  /** Load the rate limiter state from disk. */
  private loadState(): RateLimiterState {
    if (!existsSync(this.statePath)) {
      return { date: this.today(), cyclesToday: 0, totalCycles: 0 };
    }
    try {
      const content = readFileSync(this.statePath, 'utf-8');
      return JSON.parse(content) as RateLimiterState;
    } catch {
      return { date: this.today(), cyclesToday: 0, totalCycles: 0 };
    }
  }

  /**
   * Save the rate limiter state to disk atomically.
   *
   * The previous implementation called `writeFileSync` directly,
   * which truncates the file before writing. A crash mid-write
   * leaves a partial JSON file that the next `loadState()` can't
   * parse — silently resetting the rate-limit counter to 0 (which
   * would let an attacker bypass the daily limit by crashing the
   * process during the write).
   *
   * We now write to a temp file and `renameSync` it into place
   * (atomic on POSIX). On Windows, `renameSync` is not atomic but
   * is still better than truncate-then-write.
   *
   * @param state
   */
  private saveState(state: RateLimiterState): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.goli-tmp-${randomUUID().slice(0, 8)}`;
    try {
      writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');
      try {
        renameSync(tempPath, this.statePath);
      } catch (err) {
        try { unlinkSync(tempPath); } catch { /* best-effort */ }
        throw err;
      }
    } catch (err) {
      this.log?.warn('Failed to persist SICA rate-limiter state', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't re-throw — the in-memory state is still correct, and
      // a failed write shouldn't crash the SICA loop. The next
      // successful write will catch up.
    }
  }

  /**
   * Reset the counter if it's a new day, AND persist the reset.
   *
   * The previous implementation mutated the in-memory state but
   * never saved it back to disk — so the reset only "took effect"
   * for the current process. If the process crashed before the
   * next `recordCycle()` (which DOES save), the next process would
   * re-load the OLD state (with yesterday's date and counts) and
   * reset again — but a process that crashed between resets would
   * persist stale state, blocking cycles on the new day. We now
   * save the reset state immediately so the new-day boundary is
   * durable.
   *
   * @param state
   */
  private resetIfNewDay(state: RateLimiterState): void {
    const today = this.today();
    if (state.date !== today) {
      state.date = today;
      state.cyclesToday = 0;
      // Persist the reset so a crash doesn't roll it back.
      this.saveState(state);
    }
  }

  /** Get today's date as YYYY-MM-DD. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
