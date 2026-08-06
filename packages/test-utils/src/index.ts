/**
 * @goli-cli/test-utils — shared test helpers used by `perf-tests/`,
 * `memory-tests/` and the T-026 isolated test runner.
 *
 * Source-only package: consumers import the TS source directly via the
 * vitest/tsx `@goli-cli/test-utils` alias (there is no build step).
 *
 * @module @goli-cli/test-utils
 */

export {
  PerfTestHarness,
  PerfRegressionError,
} from './perf-test-harness.js';

export type {
  PerfBaselineFile,
  PerfBaselineMetric,
  PerfCheckResult,
  PerfHarnessOptions,
  PerfMeasurement,
  CheckStatus,
} from './perf-test-harness.js';
