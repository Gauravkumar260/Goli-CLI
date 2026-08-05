/**
 * Evals module public exports (Module 6).
 *
 * @module evals
 *
 * ## Layering
 *
 * The previous barrel re-exported observability modules
 * (`OtelTracer`, `LangfuseClient`, `AlertManager`) — creating a
 * circular dependency: `evals` depends on `observability`, and
 * `observability` (via tracing) depends on `evals` types for span
 * attributes. The circular import didn't crash because ES modules
 * resolve lazily, but it caused confusing "module not initialized"
 * errors in some bundlers. We now keep `evals` focused on eval
 * primitives only — callers that need observability should import
 * from `observability` directly.
 */

/**
 *
 */
export type {
  SWEBenchInstance,
  SWEBenchResult,
  BenchmarkEvaluation,
  DomainEvalTask,
  RegressionGateResult,
  AlertConfig,
  AlertType,
  TriggeredAlert,
  QualityThresholds,
} from './types.js';
/**
 *
 */
export { DEFAULT_QUALITY_THRESHOLDS } from './types.js';
/**
 *
 */
export { SWEBenchHarness, generateStubInstances } from './swebench/harness.js';
/**
 *
 */
export type { SWEBenchHarnessOptions } from './swebench/harness.js';
/**
 *
 */
export { SemanticErrorEvaluator, extractFirstJsonObject } from './semantic-check/evaluator.js';
/**
 *
 */
export type { SemanticErrorEvaluatorOptions } from './semantic-check/evaluator.js';
/**
 *
 */
export { RegressionGate } from './regression/gate.js';
/**
 *
 */
export type { RegressionGateOptions } from './regression/gate.js';
/**
 *
 */
export {
  generateRedteamConfig,
  configToYaml,
  evaluateRedteamResults,
} from './redteam/promptfoo.js';
/**
 *
 */
export type {
  PromptfooConfig,
  PromptfooProvider,
  PromptfooRedteamConfig,
  RedTeamGateResult,
} from './redteam/promptfoo.js';

// Observability re-exports REMOVED (MEDIUM-72: circular dependency).
// Import directly from '../observability/index.js' if needed.
