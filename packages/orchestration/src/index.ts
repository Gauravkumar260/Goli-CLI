/**
 * Orchestration module public exports (Module 7).
 *
 * @module orchestration
 */

/**
 *
 */
export type {
  OrchestrationPattern,
  Subtask,
  TaskDecomposition,
  BlackboardEntry,
  RoutingDecision,
  TaskComplexity,
  CloudSandboxSession,
} from './types.js';
/**
 *
 */
export { SWARM_PIPELINE, DEFAULT_ORCHESTRATION_CONFIG } from './types.js';
/**
 *
 */
export { TaskSplitter } from './decompose/task-splitter.js';
/**
 *
 */
export { WorktreeIsolation } from './worktree/isolation.js';
/**
 *
 */
export type { Worktree, WorktreeIsolationOptions } from './worktree/isolation.js';
/**
 *
 */
export { SharedBlackboard } from './shared-state/blackboard.js';
/**
 *
 */
export type { SharedBlackboardOptions } from './shared-state/blackboard.js';
/**
 *
 */
export { ComplexityClassifier, BLOCKED_PROVIDERS, ALLOWED_PROVIDERS } from './routing/classifier.js';
/**
 *
 */
export type { ComplexityClassifierOptions } from './routing/classifier.js';
/**
 *
 */
export { E2BSandbox } from './cloud/e2b.js';
/**
 *
 */
export type { E2BSandboxOptions } from './cloud/e2b.js';
/**
 *
 */
export { OrchestrationPatterns } from './patterns/index.js';
/**
 *
 */
export type { OrchestrationResult, OrchestrationPatternsOptions } from './patterns/index.js';
/**
 *
 */
export { SwarmPipeline } from './swarm-pipeline.js';
/**
 *
 */
export type { SwarmPipelineOptions } from './swarm-pipeline.js';
/**
 * Subagent context isolation (moved from core context/subagent, A3.3).
 */
export { SubagentIsolator, SUBAGENT_CONFIGS } from './isolation.js';
/**
 *
 */
export type { SubagentConfig, SubagentIsolatorOptions } from './isolation.js';
