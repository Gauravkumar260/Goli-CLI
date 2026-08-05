/**
 * Public exports for the config module.
 *
 * @module config
 *
 * MEDIUM-79: the previous barrel was missing several exports that
 * callers need — `LocalLlmsConfigSchema`, the integrity manager,
 * and the mode-tool helpers. Callers had to deep-import from
 * `./schema.js`, `./integrity.js`, and `./mode-prompts.js`. We now
 * re-export everything from the config submodules so callers can
 * import from a single entry point.
 */

/**
 *
 */
export { loadConfig, invalidateConfigCache } from './loader.js';
/**
 *
 */
export {
  MODE_PROMPTS,
  getPromptForMode,
  isToolAllowedForMode,
  READ_ONLY_TOOLS,
  PLAN_TOOLS,
} from './mode-prompts.js';
/**
 *
 */
export type { AppMode } from './mode-prompts.js';
/**
 *
 */
export {
  AppConfigSchema,
  ModelConfigSchema,
  BudgetConfigSchema,
  RetryConfigSchema,
  StallConfigSchema,
  SandboxConfigSchema,
  LoggingConfigSchema,
  LocalLlmsConfigSchema,
  ReasoningEffortSchema,
  SandboxModeSchema,
  ApprovalPolicySchema,
  DEFAULT_CONFIG,
} from './schema.js';
/**
 *
 */
export type {
  AppConfig,
  ModelConfig,
  BudgetConfig,
  RetryConfig,
  StallConfig,
  SandboxConfig,
  SandboxMode,
  ApprovalPolicy,
  LoggingConfig,
  ReasoningEffort,
  LocalLlmsConfig,
} from './schema.js';

// Integrity manager (Phase 6 — policy tampering detection).
/**
 *
 */
export {
  PolicyIntegrityManager,
  IntegrityStatus,
  calculateIntegrityHash,
} from './integrity.js';
/**
 *
 */
export type {
  IntegrityResult,
} from './integrity.js';
