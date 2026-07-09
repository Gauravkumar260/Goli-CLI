/**
 * Evals & observability types (Module 6).
 *
 * Defines the data structures for:
 * - SWE-bench evaluation results
 * - Custom domain eval results
 * - Semantic error evaluation
 * - Regression gate decisions
 * - OpenTelemetry span attributes
 * - Alert configurations
 *
 * @module evals/types
 */

/** A single SWE-bench instance (a real GitHub issue + its tests). */
export interface SWEBenchInstance {
  /** The instance ID (e.g. 'django__django-12345'). */
  instanceId: string;
  /** The repo name. */
  repo: string;
  /** The issue description. */
  problemStatement: string;
  /** The base commit to start from. */
  baseCommit: string;
  /** Tests that should pass after the fix (FAIL_TO_PASS). */
  failToPass: string[];
  /** Tests that should still pass after the fix (PASS_TO_PASS). */
  passToPass: string[];
  /** The test command to run. */
  testCommand: string;
  /** The environment setup script. */
  environmentSetup: string;
}

/** The result of evaluating a single SWE-bench instance. */
export interface SWEBenchResult {
  /** The instance ID. */
  instanceId: string;
  /** Whether the instance was resolved (all FAIL_TO_PASS pass, all PASS_TO_PASS still pass). */
  resolved: boolean;
  /** Whether the FAIL_TO_PASS tests now pass. */
  failToPassPassed: boolean;
  /** Whether the PASS_TO_PASS tests still pass. */
  passToPassPassed: boolean;
  /** The tests that passed. */
  testsPass: string[];
  /** The tests that failed. */
  testsFail: string[];
  /** Tests that regressed (were passing, now failing). */
  regressions: string[];
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Duration in ms. */
  durationMs: number;
  /** Whether this was flagged as a semantic error. */
  semanticError: boolean;
}

/** The result of evaluating against a benchmark subset. */
export interface BenchmarkEvaluation {
  /** The benchmark name (e.g. 'swe-bench-verified-50'). */
  benchmark: string;
  /** The total number of instances. */
  instanceCount: number;
  /** The number of instances resolved. */
  resolvedCount: number;
  /** The resolution rate (0.0 – 1.0). */
  resolutionRate: number;
  /** The semantic error rate (0.0 – 1.0). */
  semanticErrorRate: number;
  /** Per-instance results. */
  results: SWEBenchResult[];
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Duration in ms. */
  durationMs: number;
  /** When the evaluation was run. */
  timestamp: string;
}

/** A custom domain eval task (from real bugs/features). */
export interface DomainEvalTask {
  /** The task ID. */
  id: string;
  /** The natural-language task description. */
  description: string;
  /** The starting commit. */
  startingCommit: string;
  /** The expected patch (for verification). */
  expectedPatch?: string;
  /** Verification tests to run. */
  verificationTests: string[];
  /** The difficulty (1-2 files / 3-5 files / 5+ files). */
  difficulty: 'easy' | 'medium' | 'hard';
  /** The task type. */
  type: 'bug-fix' | 'feature' | 'refactor' | 'test' | 'docs';
  /** The golden trajectory (for regression + fine-tuning). */
  goldenTrajectoryId?: string;
}

/** The result of the regression gate check. */
export interface RegressionGateResult {
  /** Whether the gate passed (merge allowed). */
  passed: boolean;
  /** The gate decision. */
  decision: 'PASS' | 'BLOCK' | 'WARN';
  /** The current resolution rate. */
  currentRate: number;
  /** The baseline resolution rate. */
  baselineRate: number;
  /** The absolute resolution rate. */
  absoluteThreshold: number;
  /** The relative regression (current - baseline). */
  relativeRegression: number;
  /** The reason for the decision. */
  reason: string;
  /** The full benchmark evaluation. */
  evaluation?: BenchmarkEvaluation;
}

/** An alert configuration. */
export interface AlertConfig {
  /** The alert type. */
  type: AlertType;
  /** The threshold value. */
  threshold: number;
  /** Whether the alert is enabled. */
  enabled: boolean;
  /** The action to take when triggered. */
  action: 'log' | 'notify' | 'hard_stop';
}

/** Alert types for production monitoring. */
export type AlertType =
  | 'stuck_loop'
  | 'budget_exceeded'
  | 'error_rate'
  | 'latency_p95'
  | 'latency_p99'
  | 'semantic_error_rate'
  | 'daily_cost';

/** A triggered alert. */
export interface TriggeredAlert {
  /** The alert type. */
  type: AlertType;
  /** The current value that triggered the alert. */
  currentValue: number;
  /** The threshold that was exceeded. */
  threshold: number;
  /** When the alert was triggered. */
  timestamp: string;
  /** The action taken. */
  action: 'log' | 'notify' | 'hard_stop';
  /** Description of the alert. */
  description: string;
}

/** Quality thresholds for the CI eval gate. */
export interface QualityThresholds {
  /** Absolute floor for SWE-bench resolution rate (default: 0.40). */
  absoluteThreshold: number;
  /** Max relative regression from baseline (default: 0.02 = 2%). */
  relativeRegression: number;
  /** SWE-bench subset size for CI (default: 50). */
  swebenchSubsetSize: number;
  /** Session budget in USD (default: 5.00). */
  sessionBudgetUsd: number;
  /** Daily budget in USD (default: 100.00). */
  dailyBudgetUsd: number;
  /** Whether to hard-stop on daily budget exceed (default: true). */
  hardStopOnDailyExceed: boolean;
  /** Stuck-loop threshold: max tool calls (default: 20). */
  stuckLoopThreshold: number;
  /** Identical call threshold for stall detection (default: 3). */
  identicalCallThreshold: number;
  /** Wall-clock threshold in seconds (default: 1800). */
  wallclockThresholdS: number;
  /** Error rate threshold (default: 0.15). */
  errorRateThreshold: number;
  /** Semantic error sample rate (default: 0.10 = 10%). */
  semanticErrorSampleRate: number;
}

/** Default quality thresholds. */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  absoluteThreshold: 0.40,
  relativeRegression: 0.02,
  swebenchSubsetSize: 50,
  sessionBudgetUsd: 5.00,
  dailyBudgetUsd: 100.00,
  hardStopOnDailyExceed: true,
  stuckLoopThreshold: 20,
  identicalCallThreshold: 3,
  wallclockThresholdS: 1800,
  errorRateThreshold: 0.15,
  semanticErrorSampleRate: 0.10,
};
