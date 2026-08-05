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

// Prompt caching (Hermes improvement H2)
// P2-18 fix (remediation plan Phase 18): `prompt-builder.ts` was dead
// code (485 lines, never instantiated in production). Deleted along
// with its tests. The canonical system-prompt assembler is
// `SystemPromptAssembler` in `./system-prompt.js` (13 fragments).
// `computeStableHash` is also gone — `ToolsetSnapshot.computeToolNamesHash`
// covers the per-conversation stability invariant.
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

// Local-LLMs three-axis router (5th AppMode: 'local-llms')
/**
 * Three-axis router across local Ollama workers + cloud tier.
 */
export {
  LocalLlmsRouter,
  detectSensitivity,
  redactPii,
  restorePii,
  scoreComplexity,
  pickPrimary,
  buildFallbackChain,
} from './local-llms-router.js';
/**
 *
 */
export type {
  LocalLlmsCallable,
  LocalLlmsResponse,
  LocalLlmsStreamChunk,
  SensitivityTag,
  ComplexityScores,
  CircuitState,
  RoutingDecision,
  DeploymentId,
} from './local-llms-router.js';

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

// P2-18 fix (remediation plan Phase 18): `callback-streaming.ts` (428
// lines) was unused in production — `AgentLoop` consumes the model
// client's native async iterator directly. Deleted along with its
// tests. The `StreamCallback` / `StreamingQueue` abstraction was a
// Hermes-pattern leftover that never wired into the loop.

// ─── Experimental / unused-in-loop subsystems ─────────────────────────
// These modules are fully implemented. Some are consumed by `AgentLoop`
// (see individual annotations); others are exported here so external
// callers CAN use them directly (the previous situation was the
// worst-of-both-worlds: code existed but was unreachable, lulling
// maintainers into thinking the feature shipped while it silently did
// nothing). Each export is annotated with its consumption status so
// consumers know whether to expect loop-level integration.
/**
 * Reflexion self-critique loop. P2-18 fix (remediation plan Phase 18):
 * now WIRED into `AgentLoop` — `loop.ts` instantiates a `ReflexionEngine`
 * in its constructor and calls `reflect()` after each tool-call failure.
 * The accumulated reflections are injected into the next system prompt
 * via `formatForPrompt()`. External callers can still construct
 * standalone instances (e.g., for testing or post-hoc analysis on a
 * finished trajectory).
 */
export { ReflexionEngine } from './reflexion.js';
/**
 *
 */
export type { Reflection, ReflexionEngineOptions } from './reflexion.js';
/**
 * P2-9 fix (re-verification report item N1): Effort router (low/high/max
 * routing). IS consumed by `AgentLoop` — `loop.ts:593` instantiates
 * `new EffortRoutingClient({ client, logger })` and assigns it to
 * `this.client` (unless `defaultAppMode === 'local-llms'`, where the
 * LocalLlmsRouter handles routing instead). The wrapper inspects each
 * model call and routes to the configured effort level. Exported here
 * so external callers can construct standalone instances (e.g., for
 * testing or for a non-loop model client).
 */
export { EffortRoutingClient } from './effort-router.js';
/**
 *
 */
export type { ModelCallable as EffortModelCallable, EffortRoutingClientOptions } from './effort-router.js';
/**
 * P2-9 fix (re-verification report item N1): Provenance tracker for
 * trusted-tool restrictions. IS consumed by `AgentLoop` — `loop.ts:654`
 * instantiates `new ProvenanceTracker()` and assigns it to
 * `this.provenance`. The loop calls `this.provenance.tag(...)` when
 * building the prompt context so prompt-injection defense
 * (`canTriggerAction`) can gate downstream actions on whether upstream
 * content came from a trusted tool. Exported here so external callers
 * can construct standalone instances or inspect the trust tags.
 */
export {
  ProvenanceTracker,
  isSensitiveTool,
  isWebTool,
} from './provenance.js';
/**
 *
 */
export type { TrustLevel, ProvenanceTag } from './provenance.js';

/**
 *
 */
export { LoopDetector, detectToolCallLoop, detectContentLoop, TOOL_CALL_LOOP_THRESHOLD, CONTENT_LOOP_THRESHOLD } from './loop-detector.js';
/**
 *
 */
export type { LoopType, LoopDetectedEvent, LoopDetectionError, LoopDetectorOptions, ToolCallRecord } from './loop-detector.js';
/**
 *
 */
export { createFrozenSnapshot, renderFrozenSnapshot, FROZEN_SNAPSHOT_PREFIX, FROZEN_SNAPSHOT_END_MARKER } from './frozen-snapshot.js';
/**
 *
 */
export type { FrozenSnapshot } from './frozen-snapshot.js';
