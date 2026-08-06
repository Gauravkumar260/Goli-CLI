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

import type { BenchmarkEvaluation, RegressionGateResult } from '../types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

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
   * The previous implementation only checked resolution rate — it
   * ignored the semantic error rate (the % of "solved" cases that
   * are actually wrong). A PR that gamed the benchmark (e.g.,
   * modifying test files to pass) would have a high resolution rate
   * AND a high semantic error rate. We now also block on semantic
   * error rate above the threshold (default: 20%).
   *
   * @param evaluation - The benchmark evaluation to check.
   * @returns The gate result.
   */
  check(evaluation: BenchmarkEvaluation): RegressionGateResult {
    const currentRate = evaluation.resolutionRate;
    const relativeRegression = currentRate - this.baselineRate;
    // Semantic error rate gate (MEDIUM-69). DEFAULT_QUALITY_THRESHOLDS
    // doesn't currently define this — default to 0.20 (20%).
    const semanticErrorThreshold = 0.20;

    // 0. Check semantic error rate (catches benchmark gaming).
    if (evaluation.semanticErrorRate > semanticErrorThreshold) {
      const result: RegressionGateResult = {
        passed: false,
        decision: 'BLOCK',
        currentRate,
        baselineRate: this.baselineRate,
        absoluteThreshold: this.absoluteThreshold,
        relativeRegression,
        reason: `Semantic error rate too high: ${(evaluation.semanticErrorRate * 100).toFixed(1)}% > ${(semanticErrorThreshold * 100).toFixed(1)}% (likely benchmark gaming — patches pass tests but are functionally wrong).`,
        evaluation,
      };
      this.log?.warn('Regression gate BLOCKED (semantic error rate)', { ...result });
      return result;
    }

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
   * The previous implementation constructed a NEW RegressionGate
   * with the stricter opts, but the new gate's `baselineSet` flag
   * was derived from `opts.baselineRate !== undefined`. Since
   * `this.baselineRate` was 0 (the default) when no baseline had
   * been set, the new gate's `baselineSet` was `false` even if the
   * PARENT gate had an explicit baseline — the relative-regression
   * check was silently skipped on pre-release. We now propagate
   * the parent's `baselineSet` flag.
   *
   * @param evaluation - The full benchmark evaluation.
   * @returns The gate result.
   */
  checkPreRelease(evaluation: BenchmarkEvaluation): RegressionGateResult {
    // Pre-release uses stricter thresholds.
    const stricterGate = new RegressionGate({
      logger: this.log,
      absoluteThreshold: this.absoluteThreshold,
      relativeRegression: this.relativeRegression / 2, // Half the CI threshold
      baselineRate: this.baselineSet ? this.baselineRate : undefined,
    });
    // If the parent had a baseline set, propagate the flag (the
    // constructor only sets baselineSet=true when baselineRate is
    // passed; we mirror the parent's state here).
    if (this.baselineSet) {
      stricterGate.baselineSet = true;
    }
    return stricterGate.check(evaluation);
  }
}
