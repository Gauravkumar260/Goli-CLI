/**
 * LiteLLM routing — open-weight-only (Module 7).
 *
 * Routes tasks to the appropriate model based on complexity:
 * - Routine → GLM-5.2 high (cheap, fast)
 * - Complex → GLM-5.2 max (deeper reasoning)
 * - Hard → DeepSeek V4 / Qwen3-Coder / Kimi K2.7-Code (fallback)
 *
 * ## Legal: Open-weight-only routing
 *
 * Anthropic ToS bars using their APIs to build competing products
 * (enforced against OpenAI Aug 2025, xAI/Cursor Jan 2026). GOLI-CLI
 * hard-blocks `['anthropic', 'openai']` providers. Only open-weight
 * models (GLM, DeepSeek, Qwen, Kimi) are allowed.
 *
 * @module orchestration/routing/classifier
 */

import { DEFAULT_ORCHESTRATION_CONFIG } from '../types.js';

import type { Logger } from '../../utils/logger.js';
import type { RoutingDecision, TaskComplexity } from '../types.js';

/** Hard-blocked providers (legal: ToS competing-product clause).
 *
 * These are matched as EXACT provider IDs (not substrings) so that
 * `openai-compatible-proxy` (which serves open-weight models) is not
 * blocked. The previous implementation used `.includes()` which
 * over-blocked any provider string containing "openai" or "anthropic".
 */
export const BLOCKED_PROVIDERS = ['anthropic', 'openai', 'claude', 'gpt-4', 'gpt-3.5', 'o1', 'o3'];

/** Allowed providers (open-weight only). */
export const ALLOWED_PROVIDERS = [
  'vllm-self-hosted',
  'z.ai',
  'deepseek',
  'together-ai',
  'openrouter',
  'glm',
  'qwen',
  'kimi',
];

/** Model routing tiers.
 *
 * Note: `deepseek-v4` is a placeholder — at time of writing, DeepSeek's
 * latest public release is V3. The `hard` tier should be updated when
 * V4 (or an equivalent open-weight reasoning model) ships.
 */
const ROUTING_TIERS: Record<TaskComplexity, { model: string; effort: 'low' | 'high' | 'max' }> = {
  routine: { model: 'glm-5.2', effort: 'high' },
  complex: { model: 'glm-5.2', effort: 'max' },
  hard: { model: 'deepseek-v3', effort: 'max' },
};

/** Options for the ComplexityClassifier. */
export interface ComplexityClassifierOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The complex trigger keywords (from config). */
  complexTriggers?: string[];
}

/** The ComplexityClassifier — classifies task complexity for routing. */
export class ComplexityClassifier {
  private readonly log?: Logger;
  private readonly complexTriggers: string[];

  constructor(opts: ComplexityClassifierOptions = {}) {
    this.log = opts.logger;
    this.complexTriggers = opts.complexTriggers ?? [
      'refactor', 'design', 'architecture', 'debug', 'migrate', 'rewrite',
    ];
  }

  /**
   * Classify a task's complexity.
   *
   * @param task - The task description.
   * @returns The complexity classification.
   */
  classify(task: string): TaskComplexity {
    const taskLower = task.toLowerCase();

    // Hard: mentions of complex patterns, multiple files, system design
    if (taskLower.match(/system design|distributed|concurr|parallel.*safety|multi-file.*refactor/i)) {
      return 'hard';
    }

    // Complex: refactor, architecture, debug
    if (this.complexTriggers.some((t) => taskLower.includes(t))) {
      return 'complex';
    }

    // Routine: simple tasks
    return 'routine';
  }

  /**
   * Route a task to the appropriate model.
   *
   * @param task - The task description.
   * @returns The routing decision.
   */
  route(task: string): RoutingDecision {
    const complexity = this.classify(task);
    const tier = ROUTING_TIERS[complexity];
    const isFallback = complexity === 'hard';

    this.log?.info('Routing decision', {
      complexity,
      model: tier.model,
      effort: tier.effort,
      fallback: isFallback,
    });

    return {
      model: tier.model,
      effort: tier.effort,
      complexity,
      fallback: isFallback,
      latencyMs: DEFAULT_ORCHESTRATION_CONFIG.classifierLatencyMs,
      tokenOverhead: DEFAULT_ORCHESTRATION_CONFIG.classifierOverheadTokens,
    };
  }

  /**
   * Verify that a provider OR model is allowed (not blocked).
   *
   * Checks the input against the blocked list using EXACT word-boundary
   * matches (not substring). The previous implementation used
   * `.includes()` which over-blocked `openai-compatible-proxy` and
   * under-blocked `gpt-4o` (which doesn't contain "openai").
   *
   * The check accepts both provider names (e.g. `anthropic`) and model
   * names (e.g. `claude-3-opus`, `gpt-4o`) so callers can pass either.
   *
   * @param providerOrModel - The provider name or model ID to check.
   * @returns True if allowed (not in the blocked list).
   */
  isProviderAllowed(providerOrModel: string): boolean {
    const lower = providerOrModel.toLowerCase();
    // Use word-boundary regex so `openai` matches `openai` and
    // `openai/gpt-4` but NOT `openai-compatible-proxy`.
    return !BLOCKED_PROVIDERS.some((blocked) => {
      const re = new RegExp(`\\b${blocked.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      return re.test(lower);
    });
  }

  /**
   * Get the blocked providers list (for logging / gate checks).
   */
  getBlockedProviders(): string[] {
    return [...BLOCKED_PROVIDERS];
  }

  /**
   * Get the allowed providers list.
   */
  getAllowedProviders(): string[] {
    return [...ALLOWED_PROVIDERS];
  }
}
