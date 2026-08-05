/**
 * Budget tracker (Module 1).
 *
 * Tracks four budget dimensions and enforces hard limits:
 * 1. **Tokens** — total output tokens (input + output + thinking)
 * 2. **Cost** — USD cost (computed from token counts × cost rates)
 * 3. **Iterations** — number of agent-loop iterations
 * 4. **Wall-clock** — seconds since the loop started
 *
 * When any budget is exceeded, the stop engine fires with reason
 * `'budget'`.
 *
 * ## Defaults (from config/schema.ts)
 *
 * - `maxTokens`: 800,000 (80% of 1M, leaves compaction headroom)
 * - `maxCostUsd`: $5.00 per session
 * - `maxIterations`: 50
 * - `maxWallclockSeconds`: 1800 (30 min)
 *
 * @module agent/budget
 */

import type { BudgetConfig } from '../config/schema.js';

/** A snapshot of the budget state at a point in time. */
export interface BudgetSnapshot {
  /** Total input tokens consumed. */
  inputTokens: number;
  /** Total output tokens consumed. */
  outputTokens: number;
  /** Total thinking tokens consumed. */
  thinkingTokens: number;
  /** Total tokens (input + output + thinking). */
  totalTokens: number;
  /** Total USD cost. */
  totalCostUsd: number;
  /** Number of iterations completed. */
  iterations: number;
  /** Wall-clock seconds elapsed. */
  wallclockSeconds: number;
  /** Whether any budget limit has been exceeded. */
  exceeded: boolean;
  /** Which budget was exceeded (if any). */
  exceededReason?: string;
}

/** Result of checking the budget. */
export interface BudgetStatus {
  /** Whether the budget is still within limits. */
  ok: boolean;
  /** Why the budget was exceeded (if `ok` is false). */
  reason?: string;
  /** Current snapshot. */
  snapshot: BudgetSnapshot;
}

/**
 * Budget tracker — enforces token / cost / iteration / wall-clock limits.
 *
 * @module agent/budget
 */
export class BudgetTracker {
  private readonly config: BudgetConfig;
  // Lazily set on the first `recordCall`/`recordIteration`/`snapshot` call.
  // Constructed when the tracker is created but only "started" when work
  // actually begins — so wall-clock budget reflects run time, not setup time.
  private startedAt: number | null = null;

  private inputTokens = 0;
  private outputTokens = 0;
  private thinkingTokens = 0;
  private iterations = 0;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Mark the budget tracker as started. Called by the agent loop at the top
   * of `run()`. Idempotent: subsequent calls are no-ops.
   */
  start(): void {
    if (this.startedAt === null) {
      this.startedAt = Date.now();
    }
  }

  /**
   * Reset the tracker for a new run. Clears all counters and restarts the
   * wall-clock timer.
   */
  reset(): void {
    this.startedAt = null;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.thinkingTokens = 0;
    this.iterations = 0;
  }

  /**
   * Record tokens consumed by a single GLM call.
   *
   * Defensive against NaN/negative values: a malformed `usage` field from
   * the API would otherwise poison all subsequent totals.
   * @param inputTokens
   * @param outputTokens
   * @param thinkingTokens
   */
  recordCall(inputTokens: number, outputTokens: number, thinkingTokens: number): void {
    this.start();
    // Use `>= 0` instead of `> 0` so legitimate 0-token
    // responses (e.g., cached responses, empty tool outputs)
    // are still recorded. The previous implementation used
    // `> 0`, silently dropping 0-token responses — the budget
    // tracker under-counted, and the caller couldn't
    // distinguish "no response" from "response with 0 tokens".
    if (Number.isFinite(inputTokens) && inputTokens >= 0) this.inputTokens += inputTokens;
    if (Number.isFinite(outputTokens) && outputTokens >= 0) this.outputTokens += outputTokens;
    if (Number.isFinite(thinkingTokens) && thinkingTokens >= 0) this.thinkingTokens += thinkingTokens;
  }

  /**
   * Record one completed loop iteration.
   */
  recordIteration(): void {
    this.start();
    this.iterations++;
  }

  /**
   * Get the current total token count.
   */
  get totalTokens(): number {
    return this.inputTokens + this.outputTokens + this.thinkingTokens;
  }

  /**
   * Get the current total cost in USD.
   */
  get totalCostUsd(): number {
    const { costPerMillionInputTokens, costPerMillionOutputTokens, costPerMillionThinkingTokens } =
      this.config;
    return (
      (this.inputTokens / 1_000_000) * costPerMillionInputTokens +
      (this.outputTokens / 1_000_000) * costPerMillionOutputTokens +
      (this.thinkingTokens / 1_000_000) * costPerMillionThinkingTokens
    );
  }

  /**
   * Get the wall-clock seconds elapsed since the tracker was started.
   * Returns 0 if `start()` was never called.
   */
  get wallclockSeconds(): number {
    if (this.startedAt === null) return 0;
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  /**
   * Take a snapshot of the current budget state.
   *
   * Reports ALL exceeded dimensions (not just the first) so callers can
   * surface a complete picture to the user. The previous implementation
   * reported only the first via `else if`, hiding co-exceeded dimensions.
   */
  snapshot(): BudgetSnapshot {
    // The previous implementation called `this.start()` as a side
    // effect of every `snapshot()` call. `start()` starts the
    // wall-clock timer if it hasn't been started. So merely
    // CHECKING the budget (a read operation) mutated state — a
    // caller who called `snapshot()` before the first
    // `recordCall()` would start the timer prematurely, including
    // setup time in the wall-clock budget. We now only auto-start
    // on `recordCall()` (which is the actual usage boundary).
    // `snapshot()` is a pure read — it does not mutate the timer.
    // If `startTime` is 0 (never started), wall-clock reports 0.
    const total = this.totalTokens;
    const cost = this.totalCostUsd;
    const wall = this.wallclockSeconds;
    const iters = this.iterations;

    const reasons: string[] = [];
    if (total > this.config.maxTokens) {
      reasons.push(`token limit exceeded (${total} > ${this.config.maxTokens})`);
    }
    if (cost > this.config.maxCostUsd) {
      reasons.push(`cost limit exceeded ($${cost.toFixed(4)} > $${this.config.maxCostUsd})`);
    }
    // Off-by-one fix: check `iters + 1 >= max` because `check()` runs BEFORE
    // `recordIteration()` for the current iteration. Without this, the loop
    // executes `maxIterations` full iterations PLUS one extra GLM call.
    if (iters + 1 >= this.config.maxIterations) {
      reasons.push(`iteration limit exceeded (${iters + 1} >= ${this.config.maxIterations})`);
    }
    if (wall >= this.config.maxWallclockSeconds) {
      reasons.push(`wall-clock limit exceeded (${wall}s >= ${this.config.maxWallclockSeconds}s)`);
    }

    const exceeded = reasons.length > 0;
    const exceededReason = reasons.length > 0 ? reasons.join('; ') : undefined;

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      thinkingTokens: this.thinkingTokens,
      totalTokens: total,
      totalCostUsd: cost,
      iterations: iters,
      wallclockSeconds: wall,
      exceeded,
      exceededReason,
    };
  }

  /**
   * Check if the budget is still within limits.
   */
  check(): BudgetStatus {
    const snap = this.snapshot();
    return {
      ok: !snap.exceeded,
      reason: snap.exceededReason,
      snapshot: snap,
    };
  }
}
