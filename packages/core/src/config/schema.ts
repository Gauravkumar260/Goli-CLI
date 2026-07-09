/**
 * Zod schema for GOLI-CLI's TOML configuration.
 *
 * The config is layered:
 *   1. Built-in defaults (in this file, via `DEFAULT_CONFIG`).
 *   2. `config/default.toml` (committed; per-project overrides).
 *   3. `~/.goli-cli/config.toml` (per-user overrides).
 *   4. Environment variables prefixed with `GOLI_` (highest precedence).
 *
 * The merged config is validated against {@link AppConfig} at load time.
 * A failure to validate is a fatal error — GOLI-CLI refuses to start
 * with an invalid config. This is deliberate: an invalid sandbox config
 * could leave the agent running without sandboxing, which is worse than
 * not running at all.
 *
 * @module config/schema
 */

import { z } from 'zod';

/** Reasoning-effort levels supported by the model client. */
export const ReasoningEffortSchema = z.enum(['low', 'high', 'max']);
/**
 *
 */
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** Sandbox modes (Codex three-mode standard, Module 4). */
export const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);
/**
 *
 */
export type SandboxMode = z.infer<typeof SandboxModeSchema>;

/** Approval policies (Module 4). */
export const ApprovalPolicySchema = z.enum(['on-request', 'on-failure', 'never']);
/**
 *
 */
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

/** Model configuration. */
export const ModelConfigSchema = z.object({
  /** Model identifier passed to the provider. */
  modelId: z.string().default('default'),
  /** Provider base URL. */
  baseUrl: z.string().default(''),
  /** API key. Read from `GOLI_API_KEY` env var if not set in TOML. */
  apiKey: z.string().default(''),
  /** Default reasoning effort for routine tasks. */
  defaultEffort: ReasoningEffortSchema.default('high'),
  /** Reasoning effort for complex tasks (refactor/architecture/debug). */
  complexEffort: ReasoningEffortSchema.default('max'),
  /** Trigger keywords that bump effort to `complexEffort`. */
  complexTriggers: z
    .array(z.string())
    .default(['refactor', 'design', 'architecture', 'debug', 'migrate', 'rewrite']),
  /** Max context tokens. */
  maxContextTokens: z.number().int().positive().default(1_000_000),
  /** Request timeout in ms. */
  requestTimeoutMs: z.number().int().positive().default(120_000),
  /** Enable streaming responses (recommended). */
  streaming: z.boolean().default(true),
});
/**
 *
 */
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/** Budget limits for a single agent session (Module 1 stop-conditions). */
export const BudgetConfigSchema = z.object({
  /** Maximum output tokens per session (default: 80% of 1M, leaves compaction headroom). */
  maxTokens: z.number().int().positive().default(800_000),
  /** Maximum USD cost per session (default: $5). */
  maxCostUsd: z.number().positive().default(5.0),
  /** Maximum agent-loop iterations per session (default: 50). */
  maxIterations: z.number().int().positive().default(50),
  /** Maximum wall-clock seconds per session (default: 1800 = 30 min). */
  maxWallclockSeconds: z.number().int().positive().default(1800),
  /** Token cost per 1M input tokens (USD; for cost accounting). */
  costPerMillionInputTokens: z.number().nonnegative().default(0.0),
  /** Token cost per 1M output tokens (USD). */
  costPerMillionOutputTokens: z.number().nonnegative().default(0.0),
  /** Token cost per 1M thinking tokens (USD). */
  costPerMillionThinkingTokens: z.number().nonnegative().default(0.0),
});
/**
 *
 */
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

/** Retry / backoff configuration for model calls. */
export const RetryConfigSchema = z.object({
  /** Max retry attempts for retryable errors (429, 5xx, timeouts). */
  maxRetries: z.number().int().nonnegative().default(3),
  /** Initial backoff in ms. */
  initialBackoffMs: z.number().int().positive().default(1000),
  /** Backoff multiplier (exponential). */
  backoffMultiplier: z.number().positive().default(2),
  /** Max backoff cap in ms. */
  maxBackoffMs: z.number().int().positive().default(30_000),
  /** Jitter factor (0 = no jitter, 1 = full jitter). */
  jitterFactor: z.number().min(0).max(1).default(0.5),
});
/**
 *
 */
export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/** Stall detection (Module 1; prevents the $47K LangChain incident). */
export const StallConfigSchema = z.object({
  /** Number of identical tool calls in a row to trigger stall detection. */
  identicalCallThreshold: z.number().int().positive().default(3),
  /** Window size for stall detection (in tool calls). */
  windowSize: z.number().int().positive().default(5),
  /** Max consecutive parse failures before stopping. */
  maxParseFailures: z.number().int().positive().default(3),
});
/**
 *
 */
export type StallConfig = z.infer<typeof StallConfigSchema>;

/** Sandbox configuration (Module 4; Phase 5). Stub for Phase 1. */
export const SandboxConfigSchema = z.object({
  mode: SandboxModeSchema.default('workspace-write'),
  approvalPolicy: ApprovalPolicySchema.default('on-request'),
  /** Network egress allowlist (host:port). */
  networkAllowlist: z
    .array(z.string())
    .default([
      'github.com:443',
      'pypi.org:443',
      'files.pythonhosted.org:443',
      'registry.npmjs.org:443',
      'crates.io:443',
    ]),
  /** Resource limits (cgroups v2). */
  memoryMaxMb: z.number().int().positive().default(4096),
  memoryHighMb: z.number().int().positive().default(3072),
  cpuQuotaPercent: z.number().int().positive().default(200),
  pidMax: z.number().int().positive().default(512),
  diskMaxMb: z.number().int().positive().default(10240),
  wallclockTimeoutS: z.number().int().positive().default(1800),
});
/**
 *
 */
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

/** Logging configuration. */
export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  format: z.enum(['pretty', 'json']).default('pretty'),
  lifecycleLogPath: z.string().optional(),
});
/**
 *
 */
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

/** Top-level application config. */
export const AppConfigSchema = z.object({
  model: ModelConfigSchema.default({}),
  budget: BudgetConfigSchema.default({}),
  retry: RetryConfigSchema.default({}),
  stall: StallConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});
/**
 *
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** The default config (used as the merge base in `loadConfig`). */
export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});
