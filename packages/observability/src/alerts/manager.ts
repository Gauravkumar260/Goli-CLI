/**
 * Production alerts (Module 6).
 *
 * Monitors production traces for:
 * - Stuck loops (>20 tool calls or 3+ identical calls)
 * - Budget exceeded (session or daily)
 * - High error rate (>15%)
 * - High latency (P95/P99)
 * - Semantic error rate
 *
 * @module observability/alerts
 */

import { DEFAULT_QUALITY_THRESHOLDS } from '@goli/evals';

import type { AlertType, TriggeredAlert, QualityThresholds } from '@goli/evals';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for the AlertManager. */
export interface AlertManagerOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Quality thresholds. */
  thresholds?: Partial<QualityThresholds>;
  /** Callback for triggered alerts. */
  onAlert?: (alert: TriggeredAlert) => void;
}

/** The AlertManager — monitors production metrics and triggers alerts. */
export class AlertManager {
  private readonly log?: Logger;
  private readonly thresholds: QualityThresholds;
  private readonly onAlert?: (alert: TriggeredAlert) => void;
  private readonly dailyCost: { date: string; total: number } = { date: '', total: 0 };

  constructor(opts: AlertManagerOptions = {}) {
    this.log = opts.logger;
    this.thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...opts.thresholds };
    this.onAlert = opts.onAlert;
  }

  /**
   * Check for stuck loops.
   *
   * @param toolCallCount - The number of tool calls in the current session.
   * @param identicalCallCount - The number of consecutive identical calls.
   */
  checkStuckLoop(toolCallCount: number, identicalCallCount: number): TriggeredAlert | null {
    if (toolCallCount >= this.thresholds.stuckLoopThreshold) {
      return this.trigger('stuck_loop', toolCallCount, this.thresholds.stuckLoopThreshold, 'hard_stop',
        `Stuck loop detected: ${toolCallCount} tool calls (threshold: ${this.thresholds.stuckLoopThreshold})`);
    }
    if (identicalCallCount >= this.thresholds.identicalCallThreshold) {
      return this.trigger('stuck_loop', identicalCallCount, this.thresholds.identicalCallThreshold, 'hard_stop',
        `Stuck loop detected: ${identicalCallCount} identical calls (threshold: ${this.thresholds.identicalCallThreshold})`);
    }
    return null;
  }

  /**
   * Check session budget.
   *
   * @param sessionCostUsd - The current session cost in USD.
   */
  checkSessionBudget(sessionCostUsd: number): TriggeredAlert | null {
    if (sessionCostUsd >= this.thresholds.sessionBudgetUsd) {
      return this.trigger('budget_exceeded', sessionCostUsd, this.thresholds.sessionBudgetUsd, 'hard_stop',
        `Session budget exceeded: $${sessionCostUsd.toFixed(2)} (limit: $${this.thresholds.sessionBudgetUsd})`);
    }
    return null;
  }

  /**
   * Check daily budget.
   *
   * @param costUsd - The cost to add to today's total.
   */
  checkDailyBudget(costUsd: number): TriggeredAlert | null {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyCost.date !== today) {
      this.dailyCost.date = today;
      this.dailyCost.total = 0;
    }
    this.dailyCost.total += costUsd;

    if (this.dailyCost.total >= this.thresholds.dailyBudgetUsd) {
      const action = this.thresholds.hardStopOnDailyExceed ? 'hard_stop' : 'notify';
      return this.trigger('daily_cost', this.dailyCost.total, this.thresholds.dailyBudgetUsd, action,
        `Daily budget exceeded: $${this.dailyCost.total.toFixed(2)} (limit: $${this.thresholds.dailyBudgetUsd})`);
    }
    return null;
  }

  /**
   * Check error rate.
   *
   * @param errorCount - The number of errors.
   * @param totalCount - The total number of operations.
   */
  checkErrorRate(errorCount: number, totalCount: number): TriggeredAlert | null {
    if (totalCount === 0) return null;
    const rate = errorCount / totalCount;
    if (rate >= this.thresholds.errorRateThreshold) {
      return this.trigger('error_rate', rate, this.thresholds.errorRateThreshold, 'notify',
        `Error rate high: ${(rate * 100).toFixed(1)}% (threshold: ${(this.thresholds.errorRateThreshold * 100).toFixed(1)}%)`);
    }
    return null;
  }

  /**
   * Check wall-clock latency.
   *
   * The alert type was previously `'latency_p99'` which implies
   * a statistical P99 percentile. The input is a single
   * session's wall-clock duration, not a percentile. We now use
   * `'wallclock_exceeded'` which accurately describes what's
   * being checked.
   *
   * @param wallclockSeconds - The elapsed wall-clock seconds.
   */
  checkLatency(wallclockSeconds: number): TriggeredAlert | null {
    if (wallclockSeconds >= this.thresholds.wallclockThresholdS) {
      return this.trigger('wallclock_exceeded', wallclockSeconds, this.thresholds.wallclockThresholdS, 'hard_stop',
        `Wall-clock exceeded: ${wallclockSeconds}s (threshold: ${this.thresholds.wallclockThresholdS}s)`);
    }
    return null;
  }

  /**
   * Trigger an alert.
   * @param type
   * @param currentValue
   * @param threshold
   * @param action
   * @param description
   */
  private trigger(
    type: AlertType,
    currentValue: number,
    threshold: number,
    action: TriggeredAlert['action'],
    description: string,
  ): TriggeredAlert {
    const alert: TriggeredAlert = {
      type,
      currentValue,
      threshold,
      timestamp: new Date().toISOString(),
      action,
      description,
    };

    this.log?.warn('Alert triggered', { ...alert });
    // Wrap onAlert in try/catch so a throwing callback doesn't
    // prevent the alert from being returned. The previous
    // implementation called `this.onAlert?.(alert)` synchronously
    // — if the callback threw, the exception propagated up
    // through `checkStuckLoop`/`checkSessionBudget`/etc., and
    // the caller may not handle it — the alert was effectively
    // lost (the throw prevented the return).
    try {
      this.onAlert?.(alert);
    } catch (err) {
      this.log?.error('Alert callback threw — alert still returned', {
        type: alert.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return alert;
  }

  /** Get the daily cost so far. */
  get todayCost(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.dailyCost.date === today ? this.dailyCost.total : 0;
  }
}
