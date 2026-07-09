/**
 * Evals module public exports (Module 6).
 *
 * @module evals
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
export { SemanticErrorEvaluator } from './semantic-check/evaluator.js';
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

// Re-export observability (tracing, Langfuse, alerts) for convenience
/**
 *
 */
export { OtelTracer } from '../observability/tracing/otel.js';
/**
 *
 */
export type { OtelSpan, OtelTracerOptions } from '../observability/tracing/otel.js';
/**
 *
 */
export { LangfuseClient } from '../observability/langfuse/client.js';
/**
 *
 */
export type { LangfuseClientOptions } from '../observability/langfuse/client.js';
/**
 *
 */
export { AlertManager } from '../observability/alerts/manager.js';
/**
 *
 */
export type { AlertManagerOptions } from '../observability/alerts/manager.js';
