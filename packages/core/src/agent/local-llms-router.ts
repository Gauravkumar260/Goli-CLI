/**
 * Three-axis local-LLM router (5th AppMode: `local-llms`).
 *
 * Wraps a pool of 5 `OllamaProvider` instances (4 local workers + 1 cloud
 * tier) behind the `ModelCallable` interface and routes each request
 * across them along three orthogonal axes:
 *
 *   1. SENSITIVITY (hard gate) — a Presidio-style regex/NER pass runs
 *      before any other routing decision. Restricted or PII-tagged
 *      requests NEVER touch the cloud tier. Depending on `piiGatingMode`:
 *        - 'local-only' (default): the request is forced entirely to
 *          local workers; cloud is structurally excluded.
 *        - 'redact': sensitive spans are replaced with stable
 *          placeholders before the call, then restored in the response.
 *        - 'off': sensitivity axis is disabled (testing only).
 *
 *   2. COMPLEXITY (soft scorer) — a lightweight classifier scores the
 *      request along `{ code, reasoning, retrieval, tool_use,
 *      multimodal, context_length }`. The highest-scoring dimension
 *      picks the primary worker:
 *          code          → qwen2.5-coder:7b
 *          reasoning     → qwen3:4b (thinking variant)
 *          retrieval     → qwen3:4b (RAG triad)
 *          multimodal    → gemma3:4b
 *          context_length→ gemma3:4b (128K) or cloud (>128K)
 *          trivial       → qwen3.5:4b orchestrator
 *      Hard reasoning / agentic tool chains → cloud tier (when allowed).
 *
 *   3. AVAILABILITY (runtime filter) — per-deployment circuit breaker:
 *      `CLOSED → OPEN` (N fails in W ms) `→ HALF-OPEN` (probe) `→ CLOSED`
 *      or back to `OPEN`. Cooldown is configurable. On failure, the
 *      call cascades DOWN the tier chain (cloud → orchestrator →
 *      general → fast). For restricted requests, cloud is structurally
 *      excluded from the chain.
 *
 * The router mirrors the existing `EffortRoutingClient` pattern: it
 * implements `ModelCallable`, holds an inner pool of `ModelCallable`
 * clients (each a `ProviderBackedModelClient` wrapping an
 * `OllamaProvider`), and delegates `call()` to the chosen inner client.
 *
 * ## Design notes
 *
 * - **Sensitivity tag propagation.** The tag is computed by the router's
 *   pre-call hook, NEVER trusted from the client. A client claiming
 *   `public` on a prompt containing SSNs is re-tagged `pii` by the NER
 *   pass and forced local.
 * - **Fallback direction.** Never cascade a restricted request upward.
 *   The fallback chain for restricted workloads is
 *   `orchestrator → general → fast` only. Cloud is excluded, not just
 *   deprioritized.
 * - **Context-window fallback.** If a request exceeds a worker's
 *   context budget, the router promotes to the next candidate with a
 *   sufficient window (`gemma3:4b` at 128K, then `gpt-oss:120b-cloud`).
 * - **Circuit-breaker state is per-deployment.** Each of the 5 workers
 *   has its own breaker; a flapping cloud tier doesn't take down the
 *   orchestrator.
 *
 * @module agent/local-llms-router
 */

import { OllamaProvider } from '../providers/ollama.js';

import { ProviderBackedModelClient } from './provider-adapter.js';

import type { Message, ToolCall } from './types.js';
import type { LocalLlmsConfig } from '../config/schema.js';
import type { Logger } from '../utils/logger.js';

// ─── Public types ────────────────────────────────────────────────────

/** A streaming chunk from the model (mirrors ModelStreamChunk in provider-adapter). */
export interface LocalLlmsStreamChunk {
  contentDelta?: string;
  thinkingDelta?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsFragment?: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number; thinkingTokens: number };
  finishReason?: string;
}

/** The model response shape (mirrors ModelCallResponse in provider-adapter). */
export interface LocalLlmsResponse {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

/** Sensitivity tag — the Axis-1 output. */
export type SensitivityTag = 'public' | 'internal' | 'restricted' | 'pii';

/** Complexity dimensions scored along Axis 2. */
export interface ComplexityScores {
  code: number;
  reasoning: number;
  retrieval: number;
  tool_use: number;
  multimodal: number;
  context_length: number;
  /** The total token estimate of the input messages. */
  tokenEstimate: number;
}

/** Per-deployment circuit-breaker state. */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** One entry in the routing decision trail (for observability). */
export interface RoutingDecision {
  sensitivity: SensitivityTag;
  complexity: ComplexityScores;
  /** The deployment IDs that were eligible after sensitivity filtering. */
  eligibleDeployments: DeploymentId[];
  /** The deployment that was actually chosen as primary. */
  primary: DeploymentId;
  /** The fallback chain that would be walked on failure. */
  fallbackChain: DeploymentId[];
  /** Whether a fallback was actually triggered at runtime. */
  fallbackTriggered: boolean;
  /** The deployment that ultimately produced the response. */
  servedBy: DeploymentId;
  latencyMs: number;
}

/** The 5 deployment IDs in the pool. */
export type DeploymentId =
  | 'orchestrator'
  | 'coder'
  | 'general'
  | 'fast'
  | 'cloud';

/** The call signature (mirrors ModelCallable in effort-router). */
export interface LocalLlmsCallable {
  call(params: {
    messages: Message[];
    tools?: unknown;
    effort?: 'low' | 'high' | 'max';
    stream?: boolean;
    onChunk?: (chunk: LocalLlmsStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<LocalLlmsResponse>;
}

// ─── Internal state ──────────────────────────────────────────────────

interface Deployment {
  id: DeploymentId;
  client: ProviderBackedModelClient;
  /** Context window in tokens (used for context-window fallback). */
  contextWindow: number;
  /** Whether this deployment is on the cloud tier (excluded for restricted). */
  isCloud: boolean;
  /** Circuit-breaker state. */
  circuit: CircuitState;
  /** Timestamps of recent failures (ms since epoch), rolling window. */
  failures: number[];
  /** When the breaker flipped to OPEN (ms since epoch). */
  openedAt?: number;
  /**
   * Whether a HALF_OPEN probe is currently in flight. The previous
   * implementation did NOT track this, so multiple concurrent calls
   * would all be allowed as probes (the comment admitted "we don't
   * track in-flight count here for simplicity"). That defeats the
   * single-probe semantics — if the first probe fails, the breaker
   * re-opens, but the other probes are already in flight and will
   * execute against a possibly-broken deployment.
   */
  probeInFlight?: boolean;
}

// ─── PII / sensitivity detection ─────────────────────────────────────

/**
 * Presidio-style regex patterns for common PII / restricted data.
 * Conservative on purpose: false positives (forcing local) are cheap;
 * false negatives (leaking PII to cloud) are catastrophic.
 */
const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // US SSN: 123-45-6789 (with word boundaries to avoid matching IDs)
  { name: 'SSN',        re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Credit card number (16 digits, optional separators)
  { name: 'CREDIT_CARD', re: /\b(?:\d[ -]*?){13,16}\b/g },
  // Email address
  { name: 'EMAIL',      re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Phone number (US/EU-style, 10+ digits with optional separators)
  { name: 'PHONE',      re: /(?:\+?\d[\s.-]?){10,}/g },
  // IBAN (international bank account number)
  { name: 'IBAN',       re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  // API key prefixes (common formats) — accept both `_` and `-` separators
  { name: 'API_KEY',    re: /\b(?:sk|pk|AKIA|ghp|gho|xoxb|xoxp)[_-][A-Za-z0-9]{16,}\b/g },
  // IP address (IPv4)
  { name: 'IPV4',       re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

/**
 * Keywords that mark a request as 'restricted' (regulated data — HIPAA,
 * GDPR, PCI, etc.) even if no specific PII regex matched.
 */
const RESTRICTED_KEYWORDS = [
  'hipaa', 'gdpr', 'pci-dss', 'pci dss', 'sox', 'phi', 'pii',
  'confidential', 'internal-only', 'do-not-share', 'restricted',
  'classified', 'top secret', '敏感信息', '个人身份', '机密',
];

/**
 * Run the sensitivity pass over a single text string.
 *
 * Returns the tag (public/internal/restricted/pii) and a list of
 * detected PII spans (for redaction).
 */
export function detectSensitivity(text: string): {
  tag: SensitivityTag;
  spans: Array<{ type: string; value: string; index: number; length: number }>;
} {
  const spans: Array<{ type: string; value: string; index: number; length: number }> = [];
  let foundPii = false;

  for (const { name, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      spans.push({ type: name, value: match[0], index: match.index, length: match[0].length });
      foundPii = true;
    }
  }

  if (foundPii) {
    return { tag: 'pii', spans };
  }

  const lower = text.toLowerCase();
  for (const kw of RESTRICTED_KEYWORDS) {
    if (lower.includes(kw)) {
      return { tag: 'restricted', spans: [] };
    }
  }

  return { tag: 'public', spans: [] };
}

/**
 * Run the sensitivity pass over the full message array.
 *
 * Combines the per-message tags: any 'pii' → 'pii'; else any
 * 'restricted' → 'restricted'; else 'public'.
 */
function detectSensitivityForMessages(messages: Message[]): {
  tag: SensitivityTag;
  spansByMessage: Array<Array<{ type: string; value: string; index: number; length: number }>>;
} {
  let combined: SensitivityTag = 'public';
  const spansByMessage: Array<Array<{ type: string; value: string; index: number; length: number }>> = [];
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    const { tag, spans } = detectSensitivity(text);
    spansByMessage.push(spans);
    if (tag === 'pii') combined = 'pii';
    else if (tag === 'restricted' && combined !== 'pii') combined = 'restricted';
  }
  return { tag: combined, spansByMessage };
}

/**
 * Redact sensitive spans from a text, replacing each unique value with a
 * stable placeholder. Returns the redacted text + a restore map.
 *
 * Placeholder format: `[<TYPE>_<N>]` (e.g. `[EMAIL_1]`, `[SSN_2]`).
 */
export function redactPii(text: string, spans: Array<{ type: string; value: string; index: number; length: number }>): {
  redacted: string;
  restoreMap: Map<string, string>;
} {
  if (spans.length === 0) return { redacted: text, restoreMap: new Map() };
  // Sort spans by index descending so earlier replacements don't shift later indices.
  const sorted = [...spans].sort((a, b) => b.index - a.index);
  const restoreMap = new Map<string, string>();
  const counters = new Map<string, number>();
  let result = text;
  for (const span of sorted) {
    const n = (counters.get(span.type) ?? 0) + 1;
    counters.set(span.type, n);
    const placeholder = `[${span.type}_${n}]`;
    restoreMap.set(placeholder, span.value);
    result = result.slice(0, span.index) + placeholder + result.slice(span.index + span.length);
  }
  return { redacted: result, restoreMap };
}

/** Restore placeholders in the response text using the restore map. */
export function restorePii(text: string, restoreMap: Map<string, string>): string {
  if (restoreMap.size === 0) return text;
  let result = text;
  for (const [placeholder, original] of restoreMap) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

// ─── Complexity scoring (Axis 2) ─────────────────────────────────────

/** Keywords that bump the code dimension. */
const CODE_KEYWORDS = [
  'function', 'class', 'method', 'variable', 'compile', 'runtime',
  'stack trace', 'exception', 'bug', 'error', 'refactor', 'inline',
  'extract', 'rename', 'deprecated', 'lint', 'typescript', 'javascript',
  'python', 'rust', 'go ', 'java ', 'c++', '\nimport ', '\nfrom ',
  'def ', 'func ', 'fn ', 'public ', 'private ', 'return ',
];

/** Keywords that bump the reasoning dimension. */
const REASONING_KEYWORDS = [
  'why', 'how does', 'explain', 'reason', 'prove', 'derive', 'analyze',
  'compare', 'contrast', 'trade-off', 'tradeoff', 'design', 'architect',
  'algorithm', 'complexity', 'invariant', 'correctness', 'prove that',
  'step by step', 'think through',
];

/** Keywords that bump the retrieval dimension. */
const RETRIEVAL_KEYWORDS = [
  'find', 'search', 'where is', 'lookup', 'retrieve', 'reference',
  'documented', 'docs', 'manual', 'spec', 'specification', 'notes',
  'knowledge base', 'remember', 'previously', 'earlier',
];

/** Keywords that bump the tool_use dimension (agentic). */
const TOOL_USE_KEYWORDS = [
  'run', 'execute', 'shell', 'bash', 'command', 'pipeline', 'workflow',
  'automate', 'script', 'deploy', 'provision', 'agent', 'multi-step',
  'orchestrate', 'coordinate', 'plan and execute',
];

/** Rough token estimate: ~4 chars per token (English/code blend). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Score a request along the 6 complexity dimensions.
 *
 * Each dimension is a count of keyword hits (with a small boost for
 * repeated hits), capped to a max of ~5 so no single dimension
 * dominates the routing decision by sheer keyword count.
 */
export function scoreComplexity(messages: Message[], longContextThreshold: number): ComplexityScores {
  const allText = messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
    .join('\n');
  const lower = allText.toLowerCase();
  const tokenEstimate = estimateTokens(allText);

  const countHits = (kws: string[]): number => {
    let hits = 0;
    for (const kw of kws) {
      let idx = lower.indexOf(kw);
      while (idx !== -1) {
        hits += 1;
        idx = lower.indexOf(kw, idx + kw.length);
      }
    }
    return Math.min(hits, 5);
  };

  // Multimodal: would be 5 hits if any message had non-string content
  // (image / file attachment). However, `Message.content` is typed as
  // `string` (types.ts line 28), so `typeof m.content === 'object'`
  // is always false and the previous implementation computed this as
  // 0 — the multimodal routing rule below was unreachable dead code
  // that implied a feature (multimodal routing) which doesn't exist.
  // If multimodal support is added in the future, update the
  // `Message.content` type to `string | object` and re-enable this.
  const multimodalHits = messages.some((m) => m.content !== null && typeof m.content !== 'string') ? 5 : 0;

  return {
    code: countHits(CODE_KEYWORDS),
    reasoning: countHits(REASONING_KEYWORDS),
    retrieval: countHits(RETRIEVAL_KEYWORDS),
    tool_use: countHits(TOOL_USE_KEYWORDS),
    multimodal: multimodalHits,
    context_length: tokenEstimate > longContextThreshold ? 5 : 0,
    tokenEstimate,
  };
}

/**
 * Pick the primary deployment based on complexity scores.
 *
 * The selection rules (in priority order):
 *   1. context_length ≥ threshold AND tokenEstimate > gemma3's window → cloud
 *   2. multimodal → fast (gemma3:4b)
 *   3. context_length ≥ threshold → fast (gemma3:4b at 128K)
 *   4. tool_use ≥ 3 AND reasoning ≥ 2 → cloud (agentic tool chains)
 *   5. reasoning ≥ 3 AND tool_use < 3 → cloud (hard reasoning)
 *   6. code ≥ 3 → coder
 *   7. retrieval ≥ 2 → general
 *   8. reasoning ≥ 1 → general (thinking variant)
 *   9. otherwise → orchestrator (trivial chat / route)
 *
 * Returns the chosen deployment + the name of the rule that fired
 * (for observability).
 */
export function pickPrimary(scores: ComplexityScores, _config: LocalLlmsConfig): { deployment: DeploymentId; rule: string } {
  // 1. Ultra-long context — only the cloud tier has enough window.
  if (scores.context_length >= 5 && scores.tokenEstimate > 128_000) {
    return { deployment: 'cloud', rule: 'ultra-long-context' };
  }
  // 2. Multimodal input → gemma3:4b.
  if (scores.multimodal >= 5) {
    return { deployment: 'fast', rule: 'multimodal' };
  }
  // 3. Long context → gemma3:4b (128K).
  if (scores.context_length >= 5) {
    return { deployment: 'fast', rule: 'long-context' };
  }
  // 4. Agentic tool chain → cloud.
  if (scores.tool_use >= 3 && scores.reasoning >= 2) {
    return { deployment: 'cloud', rule: 'agentic-tool-chain' };
  }
  // 5. Hard reasoning → cloud (when over the reasoning threshold).
  if (scores.reasoning >= 3 && scores.tool_use < 3) {
    return { deployment: 'cloud', rule: 'hard-reasoning' };
  }
  // 6. Code-heavy → coder.
  if (scores.code >= 3) {
    return { deployment: 'coder', rule: 'code-heavy' };
  }
  // 7. Retrieval-heavy → general (RAG triad).
  if (scores.retrieval >= 2) {
    return { deployment: 'general', rule: 'retrieval-rag' };
  }
  // 8. Some reasoning → general (thinking variant).
  if (scores.reasoning >= 1) {
    return { deployment: 'general', rule: 'reasoning-light' };
  }
  // 9. Trivial → orchestrator.
  return { deployment: 'orchestrator', rule: 'trivial-chat' };
}

/**
 * Build the fallback chain for a given primary deployment, respecting
 * the sensitivity tag.
 *
 * Rules:
 *   - For 'pii' / 'restricted' tags, the cloud tier is NEVER in the
 *     chain. The chain is orchestrator → general → fast only.
 *   - For 'public' / 'internal' tags, the chain cascades DOWN-tier
 *     from the primary. The orchestrator is the designated cloud-
 *     failover landing pad (it carries tool + thinking tokens).
 *   - The primary itself is always excluded from the chain.
 */
export function buildFallbackChain(primary: DeploymentId, tag: SensitivityTag): DeploymentId[] {
  const cloudAllowed = tag === 'public' || tag === 'internal';

  // Full chain, in cascade order (cloud first because it's the strongest,
  // then down through the local workers). The orchestrator is the landing
  // pad for cloud failover because it carries tool + thinking tokens.
  const fullCascade: DeploymentId[] = cloudAllowed
    ? ['cloud', 'orchestrator', 'general', 'fast', 'coder']
    : ['orchestrator', 'general', 'fast'];

  // Remove the primary from the chain (it's already the target).
  return fullCascade.filter((d) => d !== primary);
}

// ─── Circuit breaker ─────────────────────────────────────────────────

/**
 * Check whether a deployment is currently allowed to receive traffic.
 *
 * - CLOSED: healthy, accept traffic.
 * - OPEN: in cooldown, reject traffic (force fallback).
 * - HALF_OPEN: cooldown expired, accept a single probe; if it succeeds,
 *   close the breaker; if it fails, re-open.
 */
function isDeploymentAvailable(dep: Deployment, now: number, cooldownMs: number): boolean {
  if (dep.circuit === 'CLOSED') return true;
  if (dep.circuit === 'OPEN') {
    if (dep.openedAt !== undefined && now - dep.openedAt >= cooldownMs) {
      // Promote to HALF_OPEN — allow a single probe. Track that a
      // probe is in flight so concurrent callers don't all get to
      // probe (the previous implementation admitted "we don't track
      // in-flight count here for simplicity" — that meant multiple
      // concurrent calls in HALF_OPEN all executed as probes,
      // defeating the single-probe semantics).
      if (dep.probeInFlight) {
        return false;
      }
      dep.circuit = 'HALF_OPEN';
      dep.probeInFlight = true;
      return true;
    }
    return false;
  }
  // HALF_OPEN — only one probe at a time. If a probe is already in
  // flight, reject additional calls until the probe completes and
  // either closes or re-opens the breaker.
  if (dep.probeInFlight) {
    return false;
  }
  dep.probeInFlight = true;
  return true;
}

/**
 * Mark a HALF_OPEN probe as completed. Called by the caller after the
 * probe's result is known. On success, closes the breaker; on failure,
 * re-opens it (with a fresh `openedAt` so the cooldown restarts).
 */
function recordProbeResult(dep: Deployment, success: boolean, now: number): void {
  dep.probeInFlight = false;
  if (dep.circuit !== 'HALF_OPEN') return;
  if (success) {
    dep.circuit = 'CLOSED';
    dep.openedAt = undefined;
    dep.failures = [];
  } else {
    dep.circuit = 'OPEN';
    dep.openedAt = now;
  }
}

/** Record a successful call on the deployment (resets the breaker). */
function recordSuccess(dep: Deployment): void {
  // If we were in HALF_OPEN, this call was the probe — close the
  // breaker via the shared helper so `probeInFlight` is cleared
  // (the previous implementation did NOT clear it, leaving a
  // dangling flag that would block all future probes).
  if (dep.circuit === 'HALF_OPEN') {
    recordProbeResult(dep, true, Date.now());
    return;
  }
  dep.circuit = 'CLOSED';
  dep.failures = [];
  dep.openedAt = undefined;
  dep.probeInFlight = false;
}

/** Record a failure on the deployment (may flip the breaker to OPEN). */
function recordFailure(
  dep: Deployment,
  now: number,
  failThreshold: number,
  windowMs: number,
  cooldownMs: number,
): void {
  // Drop failures outside the rolling window.
  dep.failures = dep.failures.filter((t) => now - t < windowMs);
  dep.failures.push(now);
  if (dep.circuit === 'HALF_OPEN') {
    // This call was the probe — re-open the breaker via the shared
    // helper so `probeInFlight` is cleared.
    recordProbeResult(dep, false, now);
    return;
  }
  if (dep.failures.length >= failThreshold) {
    dep.circuit = 'OPEN';
    dep.openedAt = now;
  }
  void cooldownMs; // cooldown is enforced by isDeploymentAvailable on next probe.
}

// ─── The router ──────────────────────────────────────────────────────

/** Options for constructing a {@link LocalLlmsRouter}. */
export interface LocalLlmsRouterOptions {
  /** The loaded local-llms config (from AppConfig.localLlms). */
  config: LocalLlmsConfig;
  /** Logger instance (optional). */
  logger?: Logger;
  /**
   * Optional clock function — returns ms since epoch. Override in tests
   * to control time. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Optional fetch override for the local Ollama `/api/tags` health
   * probe. Defaults to global `fetch`. Override in tests to simulate
   * missing models.
   */
  fetchImpl?: typeof fetch;
}

/**
 * The three-axis local-LLM router.
 *
 * Usage:
 * ```ts
 * const router = new LocalLlmsRouter({ config: appConfig.localLlms, logger });
 * // router.call() now routes across the 5 workers.
 * ```
 *
 * The router is opt-in: it's only active when `appMode === 'local-llms'`.
 */
export class LocalLlmsRouter implements LocalLlmsCallable {
  private readonly log?: Logger;
  private readonly config: LocalLlmsConfig;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  /** The 5 deployments, keyed by ID. */
  private readonly deployments: Map<DeploymentId, Deployment>;

  /** The most recent routing decision (for observability / tests). */
  private lastDecision?: RoutingDecision;

  constructor(opts: LocalLlmsRouterOptions) {
    this.config = opts.config;
    this.log = opts.logger;
    this.now = opts.now ?? (() => Date.now());
    this.fetchImpl = opts.fetchImpl ?? fetch;

    const cfg = opts.config;

    // Build the 5 deployments. Each wraps an OllamaProvider in a
    // ProviderBackedModelClient so the router sees a uniform interface.
    const make = (
      id: DeploymentId,
      model: string,
      baseUrl: string,
      apiKey: string | undefined,
      contextWindow: number,
      isCloud: boolean,
    ): Deployment => ({
      id,
      client: new ProviderBackedModelClient(
        new OllamaProvider({ baseUrl, model, apiKey }),
      ),
      contextWindow,
      isCloud,
      circuit: 'CLOSED',
      failures: [],
    });

    this.deployments = new Map<DeploymentId, Deployment>([
      ['orchestrator', make('orchestrator', cfg.orchestratorModel, cfg.localBaseUrl, cfg.localApiKey || undefined, 32_000, false)],
      ['coder',        make('coder',        cfg.coderModel,        cfg.localBaseUrl, cfg.localApiKey || undefined, 32_000, false)],
      ['general',      make('general',      cfg.generalModel,      cfg.localBaseUrl, cfg.localApiKey || undefined, 32_000, false)],
      ['fast',         make('fast',         cfg.fastModel,         cfg.localBaseUrl, cfg.localApiKey || undefined, 128_000, false)],
      ['cloud',        make('cloud',        cfg.cloudModel,        cfg.cloudBaseUrl, cfg.cloudApiKey    || undefined, 128_000, true)],
    ]);
  }

  /** Returns the most recent routing decision (or undefined if no call yet). */
  getLastDecision(): RoutingDecision | undefined {
    return this.lastDecision;
  }

  /** Returns the current circuit state for a deployment (for tests/UI). */
  getCircuitState(id: DeploymentId): CircuitState {
    return this.deployments.get(id)?.circuit ?? 'CLOSED';
  }

  /**
   * The three-axis routing entry point.
   *
   * @param params
   * @param params.messages
   * @param params.tools
   * @param params.effort
   * @param params.stream
   * @param params.onChunk
   * @param params.signal
   */
  async call(params: {
    messages: Message[];
    tools?: unknown;
    effort?: 'low' | 'high' | 'max';
    stream?: boolean;
    onChunk?: (chunk: LocalLlmsStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<LocalLlmsResponse> {
    const startedAt = this.now();
    const cfg = this.config;

    // ─── Axis 1: Sensitivity (hard gate) ────────────────────────────
    const { tag: sensitivity, spansByMessage } = detectSensitivityForMessages(params.messages);
    const cloudAllowed = cfg.piiGatingMode === 'off' || (sensitivity !== 'pii' && sensitivity !== 'restricted');

    // ─── Axis 2: Complexity (soft scorer) ───────────────────────────
    const complexity = scoreComplexity(params.messages, cfg.longContextTokenThreshold);
    let { deployment: primaryId, rule } = pickPrimary(complexity, cfg);

    // If the primary is cloud but sensitivity disallows it, downgrade to
    // the orchestrator (which is the designated landing pad for cloud-
    // failover and is itself tool+thinking-capable).
    if (primaryId === 'cloud' && !cloudAllowed) {
      this.log?.debug('Cloud primary blocked by sensitivity gate; downgrading to orchestrator', {
        sensitivity, rule,
      });
      primaryId = 'orchestrator';
      rule = 'sensitivity-blocked-cloud';
    }

    // ─── Build fallback chain (respecting sensitivity) ──────────────
    const fullChain = buildFallbackChain(primaryId, cfg.piiGatingMode === 'off' ? 'public' : sensitivity);
    // Filter the chain to deployments that are currently available.
    const eligible = fullChain.filter((id) => {
      const dep = this.deployments.get(id);
      return dep ? isDeploymentAvailable(dep, this.now(), cfg.circuitBreakerCooldownMs) : false;
    });

    // The primary is always tried first (if available). If the primary
    // is in OPEN state, prepend the eligible fallback chain.
    const primaryDep = this.deployments.get(primaryId)!;
    const primaryAvailable = isDeploymentAvailable(primaryDep, this.now(), cfg.circuitBreakerCooldownMs);

    const tryOrder: DeploymentId[] = primaryAvailable
      ? [primaryId, ...eligible]
      : eligible;

    // ─── PII redaction (if enabled and tag is pii) ──────────────────
    let restoreMap = new Map<string, string>();
    let redactedMessages = params.messages;
    if (cfg.piiGatingMode === 'redact' && sensitivity === 'pii') {
      restoreMap = new Map();
      redactedMessages = params.messages.map((m, i) => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
        const { redacted, restoreMap: msgMap } = redactPii(text, spansByMessage[i] ?? []);
        for (const [ph, orig] of msgMap) restoreMap.set(ph, orig);
        return { ...m, content: redacted };
      });
    }

    // ─── Axis 3: Availability (cascade on failure) ──────────────────
    let lastError: unknown = null;
    let fallbackTriggered = false;
    let servedBy: DeploymentId | null = null;

    for (const id of tryOrder) {
      const dep = this.deployments.get(id);
      if (!dep) continue;
      // Skip cloud if not allowed (defensive — the chain should already
      // exclude it, but this guards against future config changes).
      if (dep.isCloud && !cloudAllowed) continue;

      // Context-window check: if the request exceeds the deployment's
      // window, skip it (try the next one in the chain).
      if (complexity.tokenEstimate > dep.contextWindow) {
        this.log?.debug('Skipping deployment — context window exceeded', {
          deployment: id, tokenEstimate: complexity.tokenEstimate, contextWindow: dep.contextWindow,
        });
        continue;
      }

      try {
        const response = await dep.client.call({
          messages: redactedMessages,
          tools: params.tools as Parameters<ProviderBackedModelClient['call']>[0]['tools'],
          effort: params.effort,
          stream: params.stream,
          onChunk: params.onChunk as Parameters<ProviderBackedModelClient['call']>[0]['onChunk'],
          signal: params.signal,
        });

        // Restore PII BEFORE recording success. The previous
        // implementation called `recordSuccess(dep)` BEFORE
        // `restorePii` — if `restorePii` threw (e.g., due to a
        // bug in the restore map), the success was already
        // recorded but the response was lost. The caller got
        // an error, and the deployment's circuit breaker showed
        // a success even though the call effectively failed.
        // We now restore PII first, then record success only
        // if the full response is ready.
        const content = restoreMap.size > 0 ? restorePii(response.content, restoreMap) : response.content;

        recordSuccess(dep);
        servedBy = id;

        const latencyMs = this.now() - startedAt;
        this.lastDecision = {
          sensitivity,
          complexity,
          eligibleDeployments: tryOrder,
          primary: primaryId,
          fallbackChain: fullChain,
          fallbackTriggered: id !== primaryId,
          servedBy: id,
          latencyMs,
        };

        this.log?.debug('Local-LLMs routing decision', {
          sensitivity, rule, primary: primaryId, servedBy: id,
          fallbackTriggered: id !== primaryId, latencyMs,
        });

        return {
          ...response,
          content,
        };
      } catch (err) {
        recordFailure(
          dep,
          this.now(),
          cfg.circuitBreakerFailThreshold,
          cfg.circuitBreakerWindowMs,
          cfg.circuitBreakerCooldownMs,
        );
        lastError = err;
        fallbackTriggered = true;
        this.log?.warn('Local-LLMs deployment failed; cascading to next in chain', {
          deployment: id,
          error: err instanceof Error ? err.message : String(err),
          circuitState: dep.circuit,
        });
        // Continue to the next deployment in the chain.
      }
    }

    // ─── All deployments exhausted ──────────────────────────────────
    const latencyMs = this.now() - startedAt;
    this.lastDecision = {
      sensitivity,
      complexity,
      eligibleDeployments: tryOrder,
      primary: primaryId,
      fallbackChain: fullChain,
      fallbackTriggered,
      servedBy: servedBy ?? primaryId,
      latencyMs,
    };

    const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? 'all deployments failed');
    throw new Error(
      `LocalLlmsRouter: all deployments exhausted (sensitivity=${sensitivity}, primary=${primaryId}, ` +
      `tried=[${tryOrder.join(', ')}]). Last error: ${errMsg}`,
    );
  }
}
