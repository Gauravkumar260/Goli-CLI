/**
 * Stop-condition engine (Module 1).
 *
 * The agent loop checks four stop conditions after each iteration:
 *
 * 1. **Natural completion** — the model stopped calling tools
 *    (`finishReason === 'stop'` and no tool calls in the response)
 * 2. **Budget exhaustion** — hit a token / cost / iteration / wall-clock limit
 * 3. **Stall detection** — 3+ identical tool calls in a row
 * 4. **Parse failures** — too many consecutive JSON parse failures
 *
 * Plus:
 * 5. **Aborted** — the user aborted (via AbortController)
 *
 * The engine returns a {@link StopEngineResult} telling the loop whether
 * to stop and why.
 *
 * @module agent/stop-engine
 */

import type { BudgetTracker } from './budget.js';
import type { StallDetector } from './stall-detector.js';
import type { StallConfig } from '../config/schema.js';
import type { ToolCall } from './types.js';

/** Minimal response shape needed by the stop engine. */
interface ModelResponse {
  finishReason: string;
  toolCalls: ToolCall[];
}

/** Why the loop stopped. */
export type StopReason =
  | 'completed'
  | 'budget'
  | 'stall'
  | 'error'
  | 'aborted'
  | 'not-implemented'
  | 'loop_detected';

/** Result of checking stop conditions. */
export interface StopEngineResult {
  /** Whether the loop should stop. */
  shouldStop: boolean;
  /** Why the loop should stop (if `shouldStop` is true). */
  reason?: StopReason;
  /** Human-readable message. */
  message?: string;
}

/**
 * Stop engine — checks the four stop conditions.
 *
 * @module agent/stop-engine
 */
export class StopEngine {
  private readonly budget: BudgetTracker;
  private readonly stallDetector: StallDetector;
  private readonly stallConfig: StallConfig;
  private parseFailures = 0;
  private aborted = false;

  constructor(budget: BudgetTracker, stallDetector: StallDetector, stallConfig: StallConfig) {
    this.budget = budget;
    this.stallDetector = stallDetector;
    this.stallConfig = stallConfig;
  }

  /**
   * Mark the loop as aborted (user cancelled).
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Record a JSON parse failure (from tool-call argument parsing).
   */
  recordParseFailure(): void {
    this.parseFailures++;
  }

  /**
   * Reset the parse failure counter (after a successful iteration).
   */
  resetParseFailures(): void {
    this.parseFailures = 0;
  }

  /**
   * Check all stop conditions after an iteration.
   *
   * @param response - The model response from this iteration.
   * @returns The stop result.
   */
  check(response: ModelResponse): StopEngineResult {
    // 0. Aborted (highest priority)
    if (this.aborted) {
      return {
        shouldStop: true,
        reason: 'aborted',
        message: 'Agent run aborted by user',
      };
    }

    // 1. Natural completion.
    //
    // `finishReason === 'stop'` → model emitted a stop token → completed.
    // `finishReason === 'length'` → model hit max_tokens and was cut off
    // mid-generation. Treating this as 'completed' would silently truncate
    // the response. Instead, treat as 'error' so the caller knows the
    // response was incomplete (and can retry with a higher max_tokens or
    // ask the model to continue).
    if (response.finishReason === 'length' && response.toolCalls.length === 0) {
      return {
        shouldStop: true,
        reason: 'error',
        message: 'Agent stopped: max output length reached (response truncated mid-generation)',
      };
    }
    if (response.finishReason === 'stop' && response.toolCalls.length === 0) {
      return {
        shouldStop: true,
        reason: 'completed',
        message: 'Agent completed the task',
      };
    }

    // 2. Budget exhaustion
    const budgetStatus = this.budget.check();
    if (!budgetStatus.ok) {
      return {
        shouldStop: true,
        reason: 'budget',
        message: budgetStatus.reason ?? 'Budget limit exceeded',
      };
    }

    // 3. Stall detection
    for (const toolCall of response.toolCalls) {
      if (this.stallDetector.recordAndCheck(toolCall)) {
        return {
          shouldStop: true,
          reason: 'stall',
          message: `Stall detected: ${this.stallConfig.identicalCallThreshold} identical tool calls in a row`,
        };
      }
    }

    // 4. Parse failures
    if (this.parseFailures >= this.stallConfig.maxParseFailures) {
      return {
        shouldStop: true,
        reason: 'error',
        message: `${this.parseFailures} consecutive parse failures (malformed tool-call JSON)`,
      };
    }

    // None of the conditions fired — keep going
    return { shouldStop: false };
  }
}
