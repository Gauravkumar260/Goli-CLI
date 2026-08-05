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
  baseUrl: z
    .string()
    .default('')
    .refine(
      (val) => {
        if (!val) return true; // empty string OK (provider default)
        try {
           
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'baseUrl must be a valid URL' },
    ),
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
  /** Token cost per 1M input tokens (USD; for cost accounting).
   *
   * The previous default was 0.0, which silently undercounted cost —
   * a $0.0/M default makes `costUsd` always 0 in cost accounting,
   * so the budget `maxCostUsd` never trips. We default to a
   * conservative $1.0/M (typical for small cloud models) so cost
   * accounting produces non-zero numbers unless the user explicitly
   * sets 0.0.
   */
  costPerMillionInputTokens: z.number().nonnegative().default(1.0),
  /** Token cost per 1M output tokens (USD). */
  costPerMillionOutputTokens: z.number().nonnegative().default(3.0),
  /** Token cost per 1M thinking tokens (USD). */
  costPerMillionThinkingTokens: z.number().nonnegative().default(6.0),
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
  /**
   * Memory "high" watermark (the cgroup throttles the process when
   * it crosses this; OOM-kill at `memoryMaxMb`).
   *
   * The previous schema had NO constraint that `memoryHighMb` <
   * `memoryMaxMb`. A user could set `memoryHighMb = 8192` and
   * `memoryMaxMb = 4096`, in which case the high watermark never
   * tripped and the process got OOM-killed at the lower limit
   * without warning. We now validate at parse-time that
   * `memoryHighMb < memoryMaxMb`.
   */
  memoryHighMb: z.number().int().positive().default(3072),
  cpuQuotaPercent: z.number().int().positive().default(200),
  pidMax: z.number().int().positive().default(512),
  diskMaxMb: z.number().int().positive().default(10240),
  wallclockTimeoutS: z.number().int().positive().default(1800),
}).refine(
  (cfg) => cfg.memoryHighMb < cfg.memoryMaxMb,
  {
    message: 'memoryHighMb must be strictly less than memoryMaxMb (the high watermark throttles BEFORE the OOM-kill limit).',
    path: ['memoryHighMb'],
  },
);
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

/**
 * Local-LLMs three-axis router configuration (5th AppMode).
 *
 * Defines the worker pool (4 local Ollama models + 1 cloud tier), the
 * sensitivity gate, complexity scoring thresholds, and the circuit-
 * breaker parameters used by `LocalLlmsRouter`. All values have safe
 * defaults so the mode works out of the box against a stock local
 * Ollama install + Ollama Cloud for the gpt-oss tier.
 *
 * Env overrides use the GOLI_LOCAL_LLMS_<KEY> pattern, e.g.
 *   GOLI_LOCAL_LLMS_ORCHESTRATOR_MODEL=qwen3.5:4b
 *   GOLI_LOCAL_LLMS_CLOUD_API_KEY=sk-...
 */
export const LocalLlmsConfigSchema = z.object({
  /** Always-resident orchestrator (qwen3.5:4b). Handles routing/intent + cloud-failover. */
  orchestratorModel: z.string().default('qwen3.5:4b'),
  /** Code specialist (qwen2.5-coder:7b). */
  coderModel: z.string().default('qwen2.5-coder:7b'),
  /** Reasoning / private-data RAG worker (qwen3:4b thinking). */
  generalModel: z.string().default('qwen3:4b'),
  /** Multimodal + long-context (gemma3:4b, 128K ctx). */
  fastModel: z.string().default('gemma3:4b'),
  /** Cloud tier (gpt-oss:120b-cloud via Ollama Cloud). */
  cloudModel: z.string().default('gpt-oss:120b-cloud'),
  /** Base URL for the local Ollama workers. */
  localBaseUrl: z.string().default('http://localhost:11434'),
  /** Base URL for the cloud tier (defaults to Ollama Cloud). */
  cloudBaseUrl: z.string().default('https://ollama.com'),
  /** API key for the cloud tier (optional for local-only use). */
  cloudApiKey: z.string().default(''),
  /** API key for the local Ollama workers (optional). */
  localApiKey: z.string().default(''),
  /**
   * Token threshold above which a request is considered "long-context".
   * Above this, the router prefers gemma3:4b (128K) or the cloud tier.
   */
  longContextTokenThreshold: z.number().int().positive().default(32_000),
  /** Max output tokens for local workers (caps tail latency). */
  localMaxTokens: z.number().int().positive().default(2_000),
  /** Max output tokens for the cloud tier. */
  cloudMaxTokens: z.number().int().positive().default(8_000),
  /** Cloud request timeout in ms. */
  cloudTimeoutMs: z.number().int().positive().default(30_000),
  /**
   * Circuit-breaker: number of consecutive failures that flips a
   * deployment from CLOSED → OPEN.
   */
  circuitBreakerFailThreshold: z.number().int().positive().default(3),
  /** Circuit-breaker open-state duration in ms (the cooldown). */
  circuitBreakerCooldownMs: z.number().int().positive().default(60_000),
  /** Rolling window for circuit-breaker failure counting, in ms. */
  circuitBreakerWindowMs: z.number().int().positive().default(30_000),
  /**
   * Availability health-check interval in ms. The router probes
   * GET /api/tags on the local Ollama to refresh the model-residency
   * cache. 0 disables probing (assume all configured models are present).
   */
  healthProbeIntervalMs: z.number().int().nonnegative().default(30_000),
  /**
   * PII gating mode:
   *   - 'redact'   — replace sensitive spans with placeholders, send
   *                  sanitized text to cloud, restore in response.
   *   - 'local-only' — never send restricted/PII payloads to cloud,
   *                  force the entire request to local workers.
   *   - 'off'      — sensitivity axis is disabled (NOT recommended
   *                  for production; only for testing).
   */
  piiGatingMode: z.enum(['redact', 'local-only', 'off']).default('local-only'),
});
/**
 * Configuration for the local-llms three-axis router.
 */
export type LocalLlmsConfig = z.infer<typeof LocalLlmsConfigSchema>;

/** Top-level application config. */
export const AppConfigSchema = z.object({
  model: ModelConfigSchema.default({}),
  budget: BudgetConfigSchema.default({}),
  retry: RetryConfigSchema.default({}),
  stall: StallConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  localLlms: LocalLlmsConfigSchema.default({}),
});
/**
 *
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** The default config (used as the merge base in `loadConfig`). */
export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});
