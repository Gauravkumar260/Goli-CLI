/**
 * PerfTestHarness — a minimal performance-regression harness for Goli-CLI.
 *
 * Drives the T-030 perf gate: each perf/memory test measures a named metric,
 * then compares the measured value against a committed JSON baseline. A tail
 * is deemed a *regression* only when `measured > baseline * (1 + tolerance)`.
 *
 * ## Directional (regression-only) semantics
 *
 * Metrics are durations/heaps where **lower is better**. The harness therefore
 * fails on *slower/heavier* results but tolerates *faster/lighter* ones. A
 * machine that is merely faster than the baseline (or has a smaller heap) must
 * NOT fail CI — that would make perf tests flaky across environments. Use
 * `assertAll()` / `checkAll()` which encode this direction. Set `tolerance` to
 * `Infinity` (or a very large number) for an informational-only probe.
 *
 * ## Baseline file shape
 *
 * ```json
 * {
 *   "_meta": { "description": "...", "version": 1, "environment": {} },
 *   "metrics": {
 *     "cli_version_cold_start_ms": {
 *       "value": 220,
 *       "unit": "ms",
 *       "tolerance": 0.15,
 *       "note": "median of 3 node dist/index.js --version runs"
 *     }
 *   }
 * }
 * ```
 *
 * `tolerance` is optional per metric and defaults to `0.15` (i.e. a 15%
 * regression threshold — the T-030 contract).
 *
 * @module @goli-cli/test-utils/perf-test-harness
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PerfBaselineMetric {
  /** The committed reference value (lower-is-better for durations/heap). */
  value: number;
  /** Human-readable unit, e.g. "ms", "kb", "bytes". */
  unit?: string;
  /** Fractional tolerance; exceed threshold ⇒ regression. Default `0.15`. */
  tolerance?: number;
  /** Optional note explaining how the baseline was captured. */
  note?: string;
  /** Optional raw samples the baseline value was derived from. */
  samples?: number[];
}

export interface PerfBaselineFile {
  _meta?: {
    description?: string;
    version?: number;
    methodology?: string;
    environment?: Record<string, string | number | boolean | undefined>;
  };
  metrics: Record<string, PerfBaselineMetric>;
}

export interface PerfMeasurement {
  name: string;
  value: number;
  unit?: string;
}

export type CheckStatus = 'pass' | 'regressed' | 'no-baseline';

export interface PerfCheckResult {
  name: string;
  status: CheckStatus;
  measured: number;
  baseline: number | null;
  tolerance: number;
  deltaPct: number | null;
  unit?: string;
  note?: string;
}

export interface PerfHarnessOptions {
  /**
   * Default fractional tolerance used when a metric has no explicit
   * `tolerance`. Defaults to `0.15` (the T-030 ±15% contract).
   */
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 0.15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function timeSync(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

/**
 * A small keyed set of measurements compared against a committed JSON
 * baseline. Call {@link assertAll} at the end of a perf test to enforce the
 * gate.
 */
export class PerfTestHarness {
  /** The parsed, committed baseline file. */
  readonly baseline: PerfBaselineFile;

  /** Path the baseline was loaded from (used by {@link updateBaseline}). */
  readonly baselinePath: string;

  private readonly measurements = new Map<string, PerfMeasurement>();
  private readonly defaultTolerance: number;

  constructor(baselinePath: string, options: PerfHarnessOptions = {}) {
    this.baselinePath = resolve(process.cwd(), baselinePath);
    this.baseline = JSON.parse(
      readFileSync(this.baselinePath, 'utf8'),
    ) as PerfBaselineFile;
    this.defaultTolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  }

  /** Whether the baseline defines a metric with this name. */
  hasBaseline(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.baseline.metrics, name);
  }

  /** Look up a committed baseline value for a metric (or `null`). */
  baselineOf(name: string): PerfBaselineMetric | null {
    return this.hasBaseline(name) ? this.baseline.metrics[name]! : null;
  }

  /**
   * Register a measured value directly.
   *
   * @param name - Metric key (must match a key in the baseline).
   * @param value - Measured value (duration / heap delta; lower is better).
   * @param unit - Optional unit; falls back to the baseline's unit.
   */
  record(name: string, value: number, unit?: string): this {
    this.measurements.set(name, { name, value, unit });
    return this;
  }

  /** Time a synchronous function and record the ms elapsed. */
  measure(name: string, fn: () => void, unit = 'ms'): number {
    const value = timeSync(fn);
    this.record(name, value, unit);
    return value;
  }

  /** Time an async function and record the ms elapsed. */
  async measureAsync(
    name: string,
    fn: () => Promise<unknown>,
    unit = 'ms',
  ): Promise<number> {
    const start = process.hrtime.bigint();
    await fn();
    const value = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.record(name, value, unit);
    return value;
  }

  /**
   * Record the median of N synchronous samples (useful for noisy OS-level
   * metrics like cold-start wall-clock).
   */
  measureMedian(name: string, fn: () => void, samples = 3, unit = 'ms'): number {
    const values = Array.from({ length: samples }, () => timeSync(fn));
    const value = median(values);
    this.record(name, value, unit);
    return value;
  }

  /**
   * Compare every recorded measurement against the baseline.
   *
   * Rules:
   *  - no baseline for a measured metric ⇒ status `no-baseline` (treated as
   *    failure — you must seed the baseline, typically via
   *    {@link updateBaseline}).
   *  - measured > baseline * (1 + tolerance) ⇒ status `regressed`.
   *  - otherwise ⇒ status `pass` (this includes the *faster* direction).
   */
  checkAll(): PerfCheckResult[] {
    const results: PerfCheckResult[] = [];
    for (const measurement of this.measurements.values()) {
      const baseline = this.baselineOf(measurement.name);
      if (!baseline) {
        results.push({
          name: measurement.name,
          status: 'no-baseline',
          measured: measurement.value,
          baseline: null,
          tolerance: this.defaultTolerance,
          deltaPct: null,
          unit: measurement.unit,
          note: 'No baseline recorded — run the updater to seed it.',
        });
        continue;
      }
      const tolerance = baseline.tolerance ?? this.defaultTolerance;
      const deltaPct = (measurement.value - baseline.value) / baseline.value;
      const regressed = measurement.value > baseline.value * (1 + tolerance);
      results.push({
        name: measurement.name,
        status: regressed ? 'regressed' : 'pass',
        measured: measurement.value,
        baseline: baseline.value,
        tolerance,
        deltaPct: deltaPct * 100,
        unit: measurement.unit ?? baseline.unit,
        note: baseline.note,
      });
    }
    return results;
  }

  /**
   * Run `checkAll` and throw if any metric regressed or is missing a baseline.
   * Prefer this at the end of a perf test: a failed assertion fails the run.
   *
   * @throws {@link PerfRegressionError} listing every failing metric, or a
   *   plain Error if the harness holds no measurements at all.
   */
  assertAll(): PerfCheckResult[] {
    const results = this.checkAll();
    if (results.length === 0) {
      throw new Error(
        'PerfTestHarness.assertAll() called with zero recorded measurements — record at least one metric.',
      );
    }
    const failed = results.filter(
      (r) => r.status === 'regressed' || r.status === 'no-baseline',
    );
    if (failed.length > 0) {
      const lines = failed.map((r) => {
        const pct =
          r.deltaPct === null
            ? 'no-baseline'
            : `${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(2)}%`;
        const note = r.note ? ` — ${r.note}` : '';
        return `  • ${r.name}: measured=${r.measured}${r.unit ? ` ${r.unit}` : ''}, baseline=${r.baseline}${r.unit ? ` ${r.unit}` : ''}, delta=${pct} (tolerance ${Math.round(r.tolerance * 100)}%)${note}`;
      });
      throw new PerfRegressionError(
        `Performance gate failed (${failed.length} of ${results.length} checks):\n${lines.join('\n')}`,
        results,
      );
    }
    return results;
  }

  /**
   * Write the currently recorded measurements back to the baseline file.
   * Used by `update-perf-baselines` to (re)seed
   * `perf-tests/baselines/*.json` and `memory-tests/baselines/*.json` with
   * current machine numbers.
   *
   * Preserves the existing `_meta` block, each metric's `tolerance`, and any
   * baseline metrics that were *not* remeasured in this run. The note is
   * always regenerated from the freshly measured value so note and value can
   * never disagree (e.g. after a partial reseed).
   *
   * @param outPath - Path to write; defaults to the loaded baseline path.
   */
  updateBaseline(outPath?: string): void {
    const next: PerfBaselineFile = {
      _meta: this.baseline._meta ?? {
        description: 'Goli-CLI perf baseline',
        version: 1,
      },
      metrics: { ...this.baseline.metrics },
    };
    for (const m of this.measurements.values()) {
      const prev = this.baseline.metrics[m.name];
      next.metrics[m.name] = {
        value: m.value,
        unit: m.unit ?? prev?.unit,
        tolerance: prev?.tolerance,
        note: `Remeasured ${new Date().toISOString()} (${m.value}${m.unit ? ` ${m.unit}` : ''}).`,
      };
    }
    writeFileSync(outPath ?? this.baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  }

  /** All recorded measurement names (in insertion order). */
  names(): string[] {
    return [...this.measurements.keys()];
  }

  /** Whether at least one measurement has been recorded. */
  get hasMeasurements(): boolean {
    return this.measurements.size > 0;
  }
}

/**
 * Custom error thrown by {@link PerfTestHarness.assertAll} so CI can catch and
 * inspect the raw check results independently of the human-readable message.
 */
export class PerfRegressionError extends Error {
  constructor(
    message: string,
    readonly results: PerfCheckResult[],
  ) {
    super(message);
    this.name = 'PerfRegressionError';
  }
}