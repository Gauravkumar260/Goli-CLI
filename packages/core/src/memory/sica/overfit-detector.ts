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

    // Overfitting detected if:
    // 1. Optimization improved, AND
    // 2. Holdout degraded beyond the threshold
    if (optimizationDelta > 0 && holdoutDelta < -this.maxHoldoutDegradation) {
      return {
        detected: true,
        optimizationDelta,
        holdoutDelta,
        reason: `Optimization set improved by ${(optimizationDelta * 100).toFixed(1)}% but holdout degraded by ${Math.abs(holdoutDelta * 100).toFixed(1)}% (threshold: ${(this.maxHoldoutDegradation * 100).toFixed(1)}%). This suggests overfitting to the optimization set.`,
      };
    }

    // Also flag if optimization improved but holdout didn't improve at all
    // (less severe — just a warning)
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
