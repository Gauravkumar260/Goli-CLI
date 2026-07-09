/**
 * Agent module public exports.
 *
 * @module agent
 */

/**
 *
 */
export type {
  Message,
  MessageRole,
  ToolCall,
  ToolCallStatus,
  ConversationState,
  AgentRole,
  AgentEventType,
  AgentEvent,
  AgentEventData,
  StopReason,
  Todo,
  TodoStatus,
  TodoPriority,
} from './types.js';
/**
 *
 */
export { AGENT_ROLES, AGENT_ROLE_LABELS } from './types.js';
/**
 *
 */
export {
  ProviderBackedModelClient,
  createProviderBackedClientSync,
  createProviderBackedClient,
} from './provider-adapter.js';
/**
 *
 */
export type { ModelCallResponse, ModelStreamChunk } from './provider-adapter.js';
/**
 *
 */
export { SystemPromptAssembler } from './system-prompt.js';
/**
 *
 */
export type { SystemPromptContext, SystemPromptFragment } from './system-prompt.js';
/**
 *
 */
export { Planner, PLAN_TASK_TOOL } from './planner.js';
/**
 *
 */
export { BudgetTracker } from './budget.js';
/**
 *
 */
export type { BudgetSnapshot, BudgetStatus } from './budget.js';
/**
 *
 */
export { StallDetector } from './stall-detector.js';
/**
 *
 */
export { callWithRetry, isRetryableError } from './retry.js';
/**
 *
 */
export type { RetryOptions } from './retry.js';
/**
 *
 */
export { StopEngine } from './stop-engine.js';
/**
 *
 */
export type { StopEngineResult } from './stop-engine.js';
/**
 *
 */
export { AgentLoop } from './loop.js';
/**
 *
 */
export type { AgentLoopOptions, AgentLoopInput, AgentLoopResult } from './loop.js';
/**
 *
 */
export { repairJson, parseToolCallArgs } from './json-repair.js';

// Prompt builder + caching (Hermes improvement H2)
/**
 *
 */
export { PromptBuilder, computeStableHash } from './prompt-builder.js';
/**
 *
 */
export type {
  PromptTier,
  PromptFragment,
  PromptBuildContext,
  AssembledPrompt,
  PromptBuilderOptions,
} from './prompt-builder.js';
/**
 *
 */
export {
  applySystemAnd3Strategy,
  estimateTokenSavings,
  shouldCache,
} from './prompt-caching.js';
/**
 *
 */
export type { CacheBreakpoint, CachingStrategyOptions } from './prompt-caching.js';

// T-021: per-conversation prompt caching invariant — toolset snapshot.
/**
 * Toolset snapshot — freezes the available tool list at conversation start.
 */
export { ToolsetSnapshot, computeToolNamesHash } from './toolset-snapshot.js';

// Error classifier + credential pool (Hermes improvement H3)
/**
 *
 */
export { classifyApiError, isTerminalAuthError, TERMINAL_AUTH_REASONS } from './error-classifier.js';
/**
 *
 */
export type { FailoverReason, ClassifiedError, ErrorClassifierOptions } from './error-classifier.js';
/**
 *
 */
export { CredentialPool } from './credential-pool.js';
/**
 *
 */
export type { Credential, CredentialState, CredentialPoolOptions } from './credential-pool.js';

// Advanced compression (Hermes improvement H5)
/**
 *
 */
export { AdvancedCompressor, SUMMARY_PREFIX, SUMMARY_END_MARKER } from './advanced-compression.js';
/**
 *
 */
export type { CompressionPhase, AdvancedCompressorOptions, CompressionResult } from './advanced-compression.js';

// Tool-call loop guardrails (Hermes improvement H8)
/**
 *
 */
export {
  ToolGuardrailController,
  DEFAULT_GUARDRAIL_CONFIG,
  IDEMPOTENT_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  isIdempotentTool,
  isMutatingTool,
} from './tool-guardrails.js';
/**
 *
 */
export type {
  ToolGuardrailConfig,
  GuardrailAction,
  ToolGuardrailDecision,
  ToolGuardrailControllerOptions,
} from './tool-guardrails.js';

// Callback-based streaming (Hermes improvement H9)
/**
 *
 */
export {
  StreamingQueue,
  createStreamCallback,
  createFakeResponse,
  shouldSkipFinalSend,
  runStreamingCompletion,
  accumulateChunks,
  createBufferedConsumer,
} from './callback-streaming.js';
/**
 *
 */
export type {
  StreamCallback,
  StreamChunk,
  StreamingResult,
  StreamingQueueOptions,
} from './callback-streaming.js';
