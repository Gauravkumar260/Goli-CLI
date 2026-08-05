/**
 * SICA overfitting detector (Module 5, part 4).
 *
 * Detects benchmark overfitting by comparing performance on the
 * optimization set (used by SICA to evaluate proposals) against a
 * separate holdout set (never seen by the optimizer).
 *
 * If a change improves the optimization set but degrades the holdout,
 * it's rejected — the change is overfitting to the benchmark rather
 * than improving general capability.
 *
 * @module memory/sica/overfit-detector
 */

import type { SicaEvaluation } from './types.js';

/** The result of overfitting detection. */
export interface OverfittingResult {
  /** Whether overfitting was detected. */
  detected: boolean;
  /** The optimization set delta (after - before). */
  optimizationDelta: number;
  /** The holdout set delta (after - before). */
  holdoutDelta: number;
  /** Why overfitting was detected (if applicable). */
  reason?: string;
}

/** Options for the OverfitDetector. */
export interface OverfitDetectorOptions {
  /** Max allowed holdout degradation (default: 0.02 = 2%). */
  maxHoldoutDegradation?: number;
}

/** The overfitting detector — rejects changes that help the benchmark but hurt the holdout. */
export class OverfitDetector {
  private readonly maxHoldoutDegradation: number;

  constructor(opts: OverfitDetectorOptions = {}) {
    this.maxHoldoutDegradation = opts.maxHoldoutDegradation ?? 0.02;
  }

  /**
   * Check if a SICA change overfits to the optimization set.
   *
   * The previous implementation's "hard" overfit check required
   * `optimizationDelta > 0` (the optimization set MUST have
   * improved). This missed the case where a change degraded BOTH
   * sets — the holdout degraded, but since `optimizationDelta` was
   * negative, the check was skipped, and the change was NOT flagged.
   * A change that hurts both sets is clearly bad and should be
   * rejected regardless of which set improved more.
   *
   * We now flag overfitting whenever:
   *  1. Optimization improved AND holdout degraded beyond threshold
   *     (classic overfitting), OR
   *  2. Holdout degraded beyond threshold (regardless of opt delta)
   *     — a change that hurts the holdout is bad even if it also
   *     hurts the optimization set.
   *
   * @param beforeOpt - The optimization-set evaluation before the change.
   * @param afterOpt - The optimization-set evaluation after the change.
   * @param beforeHoldout - The holdout evaluation before the change.
   * @param afterHoldout - The holdout evaluation after the change.
   * @returns The overfitting detection result.
   */
  detect(
    beforeOpt: SicaEvaluation,
    afterOpt: SicaEvaluation,
    beforeHoldout: SicaEvaluation,
    afterHoldout: SicaEvaluation,
  ): OverfittingResult {
    const optimizationDelta = afterOpt.resolutionRate - beforeOpt.resolutionRate;
    const holdoutDelta = afterHoldout.resolutionRate - beforeHoldout.resolutionRate;

    // Classic overfit: optimization improved, holdout degraded.
    if (optimizationDelta > 0 && holdoutDelta < -this.maxHoldoutDegradation) {
      return {
        detected: true,
        optimizationDelta,
        holdoutDelta,
        reason: `Optimization set improved by ${(optimizationDelta * 100).toFixed(1)}% but holdout degraded by ${Math.abs(holdoutDelta * 100).toFixed(1)}% (threshold: ${(this.maxHoldoutDegradation * 100).toFixed(1)}%). This suggests overfitting to the optimization set.`,
      };
    }

    // Holdout degraded beyond threshold, regardless of opt delta.
    // (The previous implementation skipped this — `optimizationDelta
    // > 0` was a precondition. A change that hurt BOTH sets slipped
    // through.)
    if (holdoutDelta < -this.maxHoldoutDegradation) {
      return {
        detected: true,
        optimizationDelta,
        holdoutDelta,
        reason: `Holdout degraded by ${Math.abs(holdoutDelta * 100).toFixed(1)}% (threshold: ${(this.maxHoldoutDegradation * 100).toFixed(1)}%) even though optimization set also changed by ${(optimizationDelta * 100).toFixed(1)}%. A change that hurts the holdout is rejected regardless of optimization impact.`,
      };
    }

    // Warning: optimization improved but holdout didn't improve at all.
    if (optimizationDelta > 0.05 && holdoutDelta <= 0) {
      return {
        detected: false,
        optimizationDelta,
        holdoutDelta,
        reason: `Warning: optimization set improved by ${(optimizationDelta * 100).toFixed(1)}% but holdout did not improve (${(holdoutDelta * 100).toFixed(1)}%). Possible overfitting — monitor closely.`,
      };
    }

    return {
      detected: false,
      optimizationDelta,
      holdoutDelta,
    };
  }
}
