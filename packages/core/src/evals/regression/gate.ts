/**
 * Regression gate (Module 6).
 *
 * The CI eval gate that blocks PR merges if the SWE-bench resolution
 * rate regresses beyond the threshold.
 *
 * ## Combined threshold strategy
 *
 * - **Absolute floor**: resolution rate must be ≥ 40% (hard floor)
 * - **Relative regression**: resolution rate can't drop more than 2%
 *   from the baseline
 *
 * If either fails, the gate blocks the merge.
 *
 * @module evals/regression/gate
 */

import { DEFAULT_QUALITY_THRESHOLDS } from '../types.js';

import type { Logger } from '../../utils/logger.js';
import type { BenchmarkEvaluation, RegressionGateResult } from '../types.js';

/** Options for the RegressionGate. */
export interface RegressionGateOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The absolute floor for resolution rate (default: 0.40). */
  absoluteThreshold?: number;
  /** The max relative regression (default: 0.02 = 2%). */
  relativeRegression?: number;
  /** The baseline resolution rate (loaded from the main branch). */
  baselineRate?: number;
}

/** The regression gate — blocks PRs that regress the benchmark. */
export class RegressionGate {
  private readonly log?: Logger;
  private readonly absoluteThreshold: number;
  private readonly relativeRegression: number;
  private baselineRate: number;

  constructor(opts: RegressionGateOptions = {}) {
    this.log = opts.logger;
    this.absoluteThreshold = opts.absoluteThreshold ?? DEFAULT_QUALITY_THRESHOLDS.absoluteThreshold;
    this.relativeRegression = opts.relativeRegression ?? DEFAULT_QUALITY_THRESHOLDS.relativeRegression;
    // Track whether a baseline was explicitly set. The previous
    // implementation defaulted to 0, which made the relative-regression
    // check a no-op (currentRate - 0 < -0.02 is never true). We now
    // track "baseline set" separately so the check can warn or fail when
    // no baseline is configured.
    this.baselineRate = opts.baselineRate ?? 0;
    this.baselineSet = opts.baselineRate !== undefined;
  }

  private baselineSet: boolean;

  /**
   * Set the baseline resolution rate (from the main branch).
   * @param rate
   */
  setBaseline(rate: number): void {
    this.baselineRate = rate;
    this.baselineSet = true;
    this.log?.info('Baseline set', { baselineRate: rate });
  }

  /**
   * Check if the evaluation passes the gate.
   *
   * @param evaluation - The benchmark evaluation to check.
   * @returns The gate result.
   */
  check(evaluation: BenchmarkEvaluation): RegressionGateResult {
    const currentRate = evaluation.resolutionRate;
    const relativeRegression = currentRate - this.baselineRate;

    // 1. Check absolute floor
    if (currentRate < this.absoluteThreshold) {
      const result: RegressionGateResult = {
        passed: false,
        decision: 'BLOCK',
        currentRate,
        baselineRate: this.baselineRate,
        absoluteThreshold: this.absoluteThreshold,
        relativeRegression,
        reason: `Absolute floor not met: ${(currentRate * 100).toFixed(1)}% < ${(this.absoluteThreshold * 100).toFixed(1)}%`,
        evaluation,
      };
      this.log?.warn('Regression gate BLOCKED (absolute floor)', { ...result });
      return result;
    }

    // 2. Check relative regression (only if a baseline was explicitly set).
    // The previous implementation defaulted baselineRate to 0, which made
    // this check a no-op (currentRate - 0 < -0.02 is never true). We now
    // warn if no baseline is set, so the gate doesn't silently skip the
    // relative-regression check.
    if (!this.baselineSet) {
      this.log?.warn('Regression gate: no baseline set — relative-regression check skipped', {
        currentRate,
        hint: 'Call setBaseline() with the main-branch resolution rate to enable the relative check.',
      });
    } else if (relativeRegression < -this.relativeRegression) {
      const result: RegressionGateResult = {
        passed: false,
        decision: 'BLOCK',
        currentRate,
        baselineRate: this.baselineRate,
        absoluteThreshold: this.absoluteThreshold,
        relativeRegression,
        reason: `Relative regression exceeded: dropped ${Math.abs(relativeRegression * 100).toFixed(1)}% from baseline (max allowed: ${(this.relativeRegression * 100).toFixed(1)}%)`,
        evaluation,
      };
      this.log?.warn('Regression gate BLOCKED (relative regression)', { ...result });
      return result;
    }

    // 3. Warn if there's any regression (even within threshold)
    if (relativeRegression < 0) {
      const result: RegressionGateResult = {
        passed: true,
        decision: 'WARN',
        currentRate,
        baselineRate: this.baselineRate,
        absoluteThreshold: this.absoluteThreshold,
        relativeRegression,
        reason: `Minor regression: dropped ${Math.abs(relativeRegression * 100).toFixed(1)}% from baseline (within ${(this.relativeRegression * 100).toFixed(1)}% threshold)`,
        evaluation,
      };
      this.log?.info('Regression gate WARN', { ...result });
      return result;
    }

    // 4. Pass
    const result: RegressionGateResult = {
      passed: true,
      decision: 'PASS',
      currentRate,
      baselineRate: this.baselineRate,
      absoluteThreshold: this.absoluteThreshold,
      relativeRegression,
      reason: `No regression: ${(currentRate * 100).toFixed(1)}% (baseline: ${(this.baselineRate * 100).toFixed(1)}%, delta: +${(relativeRegression * 100).toFixed(1)}%)`,
      evaluation,
    };
    this.log?.info('Regression gate PASSED', { ...result });
    return result;
  }

  /**
   * Run a pre-release check (full 500-instance benchmark).
   *
   * @param evaluation - The full benchmark evaluation.
   * @returns The gate result.
   */
  checkPreRelease(evaluation: BenchmarkEvaluation): RegressionGateResult {
    // Pre-release uses stricter thresholds
    const stricterOpts: RegressionGateOptions = {
      logger: this.log,
      absoluteThreshold: this.absoluteThreshold,
      relativeRegression: this.relativeRegression / 2, // Half the CI threshold
      baselineRate: this.baselineRate,
    };
    return new RegressionGate(stricterOpts).check(evaluation);
  }
}
