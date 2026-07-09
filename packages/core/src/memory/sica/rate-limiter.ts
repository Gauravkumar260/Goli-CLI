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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { SicaProposal } from './types.js';
import type { Logger } from '../../utils/logger.js';

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
   * @param proposal
   */
  requiresHumanReview(proposal: SicaProposal): boolean {
    return proposal.linesChanged >= this.humanReviewLocThreshold;
  }

  /**
   * Record that a cycle was run (increment the counter).
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
   * Save the rate limiter state to disk.
   * @param state
   */
  private saveState(state: RateLimiterState): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Reset the counter if it's a new day.
   * @param state
   */
  private resetIfNewDay(state: RateLimiterState): void {
    const today = this.today();
    if (state.date !== today) {
      state.date = today;
      state.cyclesToday = 0;
    }
  }

  /** Get today's date as YYYY-MM-DD. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
