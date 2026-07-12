// ─── Load .env FIRST, before any other module ───────────────────────
import './env-loader.js';

/**
 * @goli/core — public API surface for the GOLI-CLI "Brain".
 *
 * This package contains the agent loop, tools, safety gates, context
 * engine, model providers, and the 11-agent swarm orchestration logic.
 * The @goli/cli package consumes this via the `@goli/core` workspace
 * alias.
 *
 * ## Phase 2 Exports
 *
 * Phase 2 adds the Agent Core Loop (Module 1): the GLM-5.2 client,
 * system-prompt assembler, ReAct master loop, TODO/planner engine,
 * retry/backoff, budget tracking, and stall detection.
 *
 * @module @goli/core
 */

// ─── Utils ──────────────────────────────────────────────────────────
/**
 *
 */
export { APP_NAME, APP_VERSION, APP_TAGLINE, CLI_BINARY_NAME } from './utils/constants.js';
/**
 *
 */
export type { LogLevel, LogContext, Logger, LogStream } from './utils/logger.js';
/**
 *
 */
export { createLogger, configureLogger, defaultLifecycleLogPath } from './utils/logger.js';
/**
 *
 */
export {
  GoliError,
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  ModelError,
  ModelTimeoutError,
  ModelHTTPError,
  ToolValidationError,
  ToolExecutionError,
  SandboxError,
  SandboxDeniedError,
  isGoliError,
  wrapUnknown,
} from './utils/errors.js';
/**
 *
 */
export type { ErrorCategory } from './utils/errors.js';

// ─── Config ─────────────────────────────────────────────────────────
/**
 *
 */
export { loadConfig } from './config/loader.js';
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
  DEFAULT_CONFIG,
} from './config/schema.js';
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
} from './config/schema.js';
export { MODE_PROMPTS, getPromptForMode } from './config/mode-prompts.js';
export type { AppMode } from './config/mode-prompts.js';

// ─── Policy Integrity (T-064) ────────────────────────────────────────
/**
 * Policy Integrity Manager — SHA-256 hashing of policy/config files.
 */
export { PolicyIntegrityManager, IntegrityStatus } from './config/integrity.js';
/**
 *
 */
export type { IntegrityResult } from './config/integrity.js';

// ─── Agent Core Loop (Phase 2) ──────────────────────────────────────
/**
 *
 */
export {
  ProviderBackedModelClient,
  createProviderBackedClientSync,
  createProviderBackedClient,
} from './agent/provider-adapter.js';
/**
 *
 */
export type { ModelCallResponse, ModelStreamChunk } from './agent/provider-adapter.js';
/**
 * Effort-routing wrapper for model client (auto-downgrades effort on
 * tool-execution turns, upgrades on planner/final-answer turns).
 */
export { EffortRoutingClient } from './agent/effort-router.js';
/**
 * Reflexion engine — verbal self-reflection on structural failures.
 */
export { ReflexionEngine } from './agent/reflexion.js';
/**
 *
 */
export type { Reflection, ReflexionEngineOptions } from './agent/reflexion.js';
/**
 * Provenance tracking — trust-level tagging for prompt injection defense.
 */
export { ProvenanceTracker, isSensitiveTool, isWebTool } from './agent/provenance.js';
/**
 *
 */
export type { TrustLevel, ProvenanceTag } from './agent/provenance.js';
/**
 *
 */
export type { EffortRoutingClientOptions } from './agent/effort-router.js';
/**
 *
 */
export { SystemPromptAssembler } from './agent/system-prompt.js';
/**
 *
 */
export type { SystemPromptContext, SystemPromptFragment } from './agent/system-prompt.js';
/**
 *
 */
export { Planner, PLAN_TASK_TOOL } from './agent/planner.js';
/**
 *
 */
export type { Todo, TodoStatus, TodoPriority } from './agent/types.js';
/**
 *
 */
export { BudgetTracker } from './agent/budget.js';
/**
 *
 */
export type { BudgetSnapshot, BudgetStatus } from './agent/budget.js';
/**
 *
 */
export { StallDetector } from './agent/stall-detector.js';
/**
 *
 */
export { callWithRetry, isRetryableError } from './agent/retry.js';
/**
 *
 */
export type { RetryOptions } from './agent/retry.js';
/**
 *
 */
export { StopEngine } from './agent/stop-engine.js';
/**
 *
 */
export type { StopReason, StopEngineResult } from './agent/stop-engine.js';
/**
 * Loop detector — catches repeated identical tool calls / content outputs.
 */
export {
  LoopDetector,
  detectToolCallLoop,
  detectContentLoop,
  TOOL_CALL_LOOP_THRESHOLD,
  CONTENT_LOOP_THRESHOLD,
} from './agent/loop-detector.js';
/**
 *
 */
export type {
  LoopType,
  LoopDetectedEvent,
  LoopDetectionError,
  LoopDetectorOptions,
  ToolCallRecord,
} from './agent/loop-detector.js';
/**
 *
 */
export { AgentLoop } from './agent/loop.js';
/**
 *
 */
export type { AgentLoopOptions, AgentLoopInput, AgentLoopResult } from './agent/loop.js';
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
  AgentEvent,
  AgentEventType,
} from './agent/types.js';
/**
 *
 */
export { AGENT_ROLES, AGENT_ROLE_LABELS } from './agent/types.js';
/**
 *
 */
export { repairJson, parseToolCallArgs } from './agent/json-repair.js';

// ─── Tool Layer (Phase 4) ───────────────────────────────────────────
/**
 *
 */
export { ToolRegistry, createDefaultToolRegistry } from './tools/index.js';
/**
 *
 */
export type {
  Tool,
  ToolResult,
  ToolContext,
  ToolDefinition,
  ToolInputSchema,
  ToolHandler,
  PermissionTier,
} from './tools/index.js';
/**
 *
 */
export { toToolDefinition, toToolCallUpdate } from './tools/index.js';
/**
 *
 */
export { validateToolArgs, formatValidationErrors } from './tools/index.js';
/**
 *
 */
export type { ValidationResult, ValidationError } from './tools/index.js';
/**
 *
 */
export { truncateResult, MAX_TOOL_RESULT_TOKENS } from './tools/index.js';
/**
 *
 */
export type { TruncationResult } from './tools/index.js';
/**
 *
 */
export {
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  GREP_TOOL,
  BASH_TOOL,
  HookEngine,
  registerBuiltinHooks,
  BLOCK_DESTRUCTIVE_HOOK,
  BLOCK_SECRETS_HOOK,
  BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK,
  AUTO_FORMAT_HOOK,
  GIT_CHECKPOINT_HOOK,
  AUDIT_LOG_HOOK,
  MCPClientManager,
  REFERENCE_MCP_SERVERS,
} from './tools/index.js';
/**
 *
 */
export type {
  HookEvent,
  HookDecision,
  PreToolUseHookResult,
  PostToolUseHookResult,
  UserPromptSubmitHookResult,
  HookContext,
  Hook,
  MCPTransport,
  MCPServerConfig,
  MCPTool,
  MCPSession,
  MCPConnectionState,
  MCPClientManagerOptions,
  MCPToolCallResult,
} from './tools/index.js';

// ─── Sandbox (Phase 5) ──────────────────────────────────────────────
/**
 *
 */
export {
  validatePath,
  isSymlink,
  isSymlinkCreationCommand,
  generateSeatbeltProfile,
  buildSeatbeltCommand,
  generateBubblewrapCommand,
  isBubblewrapAvailable,
  isLandlockSupported,
  NetworkEgressFilter,
  DEFAULT_NETWORK_ALLOWLIST,
  generateCgroupConfig,
  generateCgroupSetupScript,
  generateCgroupCleanupScript,
  isCgroupsV2Available,
  DEFAULT_RESOURCE_LIMITS,
  getAuditLogPath,
  appendAuditLog,
  readAuditLog,
  verifyAuditLog,
  getAuditLogSummary,
  executeInSandbox,
  ApprovalEngine,
  computeBlastRadius,
  DEFAULT_BLAST_RADIUS_CONFIG,
} from './sandbox/index.js';
/**
 *
 */
export type {
  SandboxResult,
  PathValidationResult,
  NetworkDestination,
  NetworkEgressResult,
  ApprovalDecision,
  ApprovalRequest,
  AuditLogEntry,
  ResourceLimits,
  NetworkAllowlist,
  ActionClassification,
  ApprovalEngineOptions,
  BlastRadiusConfig,
  BlastRadiusResult,
  SandboxExecutorOptions,
} from './sandbox/index.js';

// ─── Context Engine (Phase 7) ───────────────────────────────────────
/**
 *
 */
export { TreeSitterIndexer, SymbolGraph, HybridRetriever, CompactionEngine, SubagentIsolator, SUBAGENT_CONFIGS, createContextEngine } from './context/index.js';
/**
 * Project map generator — Aider-style compressed repo map.
 */
export { ProjectMapGenerator } from './context/project-map.js';
/**
 *
 */
export type { ProjectMapGeneratorOptions } from './context/project-map.js';
/**
 *
 */
export type {
  SemanticChunk,
  SymbolType,
  SymbolNode,
  SymbolEdge,
  SymbolEdgeType,
  RetrievalResult,
  RetrievalStrategy,
  QueryType,
  SubagentType,
  SubagentSpawnRequest,
  SubagentResult,
  CompactionState,
  SymbolGraphOptions,
  HybridRetrieverOptions,
  CompactionEngineOptions,
  SubagentConfig,
  SubagentIsolatorOptions,
} from './context/index.js';

// ─── Memory System (Phase 8-9) ──────────────────────────────────────
/**
 *
 */
export {
  PersistentMemory,
  SessionMemory,
  VectorMemoryPlugin,
  MemoryCurator,
  MEMORY_BUDGETS,
  TOTAL_MEMORY_BUDGET,
  createMemorySystem,
  SkillWriter,
  SkillCatalog,
  SkillLoader,
  SkillArchiver,
  SEED_SKILLS,
  AUTO_ARCHIVE_DAYS,
  MAX_L2_TOKENS,
  ESTIMATED_L1_TOKENS,
  TrajectoryStore,
  TrajectoryCurator,
  computeReward,
  shouldKeepForTraining,
  DatasetBuilder,
  GRPOScaffold,
  ImmutableSafetyRegistry,
  SafetyOverseer,
  SicaArchive,
  OverfitDetector,
  SicaRateLimiter,
  SicaLoop,
  DEFAULT_SICA_OPTIONS,
} from './memory/index.js';
/**
 *
 */
export type {
  MemoryTier,
  SessionMemoryEntry,
  MemoryCategory,
  PersistentMemoryFile,
  MemorySnapshot,
  ExternalMemoryPlugin,
  ExternalMemoryResult,
  CuratedLearning,
  PersistentMemoryOptions,
  VectorMemoryPluginOptions,
  MemoryCuratorOptions,
  SkillMetadata,
  SkillCategory,
  Skill,
  TrajectoryEntry,
  SkillWriterOptions,
  SkillCatalogOptions,
  SkillLoaderOptions,
  DisclosureLevel,
  TrajectoryStep,
  Trajectory,
  TrajectoryOutcome,
  TrainingDataset,
  TrainingExample,
  CurationStrategy,
  RewardComponents,
  TrajectoryStoreOptions,
  TrajectoryCuratorOptions,
  RewardFunctionOptions,
  DatasetBuilderOptions,
  GRPOScaffoldOptions,
  SicaTarget,
  SicaProposal,
  SicaEvaluation,
  OverseerVerdict,
  OverseerConcern,
  OverseerConcernCategory,
  SicaCycleResult,
  ArchiveEntry,
  SicaLoopOptions,
  SafetyOverseerOptions,
  SicaArchiveOptions,
  OverfitDetectorOptions,
  OverfittingResult,
  SicaRateLimiterOptions,
  SicaLoopConstructorOptions,
} from './memory/index.js';

// ─── Evals & Observability (Phase 12) ───────────────────────────────
/**
 *
 */
export {
  SWEBenchHarness,
  generateStubInstances,
  SemanticErrorEvaluator,
  RegressionGate,
  generateRedteamConfig,
  configToYaml,
  evaluateRedteamResults,
  DEFAULT_QUALITY_THRESHOLDS,
  OtelTracer,
  LangfuseClient,
  AlertManager,
} from './evals/index.js';
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
  SWEBenchHarnessOptions,
  SemanticErrorEvaluatorOptions,
  RegressionGateOptions,
  PromptfooConfig,
  PromptfooProvider,
  PromptfooRedteamConfig,
  RedTeamGateResult,
  OtelSpan,
  OtelTracerOptions,
  LangfuseClientOptions,
  AlertManagerOptions,
} from './evals/index.js';

// ─── Multi-Agent Orchestration (Phase 13) ───────────────────────────
/**
 *
 */
export {
  TaskSplitter,
  WorktreeIsolation,
  SharedBlackboard,
  ComplexityClassifier,
  E2BSandbox,
  OrchestrationPatterns,
  SwarmPipeline,
  SWARM_PIPELINE,
  DEFAULT_ORCHESTRATION_CONFIG,
  BLOCKED_PROVIDERS,
  ALLOWED_PROVIDERS,
} from './orchestration/index.js';
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
  Worktree,
  WorktreeIsolationOptions,
  SharedBlackboardOptions,
  ComplexityClassifierOptions,
  E2BSandboxOptions,
  OrchestrationResult,
  OrchestrationPatternsOptions,
  SwarmPipelineOptions,
} from './orchestration/index.js';

// ─── API Server (Hermes improvement H10) ────────────────────────────
/**
 *
 */
export { ApiServer } from './api/index.js';
/**
 *
 */
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelEntry,
  RunRequest,
  RunStatus,
  ApiServerOptions,
} from './api/index.js';

// ─── Plugin System (Hermes improvement H11) ─────────────────────────
/**
 *
 */
export { PluginRegistry, pluginRegistry, VALID_HOOKS } from './plugins/index.js';
/**
 *
 */
export type {
  MiddlewareKind,
  HookHandler,
  HookContext as PluginHookContext,
  MiddlewareHandler,
  MiddlewareContext,
  PluginCommand,
  Plugin,
  PluginContext,
  PluginInit,
  PluginRegistryOptions,
} from './plugins/index.js';
