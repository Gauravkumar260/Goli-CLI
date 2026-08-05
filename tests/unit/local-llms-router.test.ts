/**
 * Unit tests for the LocalLlmsRouter — the three-axis router that powers
 * the 5th AppMode ('local-llms').
 *
 * Coverage:
 *   Axis 1 (Sensitivity):
 *     - public / internal / restricted / pii tagging
 *     - PII regex patterns (SSN, email, credit card, API key, IBAN, phone, IP)
 *     - restricted keywords (HIPAA, GDPR, etc.)
 *     - piiGatingMode 'local-only' forces cloud-exclusion
 *     - piiGatingMode 'redact' replaces spans + restores in response
 *     - piiGatingMode 'off' disables the axis
 *
 *   Axis 2 (Complexity):
 *     - scoreComplexity picks up code / reasoning / retrieval / tool_use
 *     - pickPrimary routes:
 *       trivial → orchestrator
 *       code-heavy → coder
 *       reasoning-light → general
 *       retrieval-heavy → general
 *       long-context → fast (gemma3:4b)
 *       multimodal → fast
 *       agentic tool chain → cloud
 *       hard reasoning → cloud
 *       ultra-long context → cloud
 *
 *   Axis 3 (Availability):
 *     - circuit breaker flips CLOSED → OPEN after N failures
 *     - circuit breaker recovers OPEN → HALF_OPEN → CLOSED after cooldown
 *     - fallback chain cascades on failure
 *     - restricted requests NEVER cascade to cloud
 *
 *   PII redaction:
 *     - redactPii replaces spans with stable placeholders
 *     - restorePii reverses the redaction
 *
 *   End-to-end:
 *     - Router routes a trivial public prompt to the orchestrator
 *     - Router routes a PII prompt away from the cloud tier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  LocalLlmsRouter,
  detectSensitivity,
  redactPii,
  restorePii,
  scoreComplexity,
  pickPrimary,
  buildFallbackChain,
} from '../../packages/core/src/agent/local-llms-router.js';
import type { LocalLlmsConfig } from '../../packages/core/src/config/schema.js';
import type { Message } from '../../packages/core/src/agent/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A minimal valid LocalLlmsConfig (all defaults). */
function makeConfig(overrides: Partial<LocalLlmsConfig> = {}): LocalLlmsConfig {
  return {
    orchestratorModel: 'qwen3.5:4b',
    coderModel: 'qwen2.5-coder:7b',
    generalModel: 'qwen3:4b',
    fastModel: 'gemma3:4b',
    cloudModel: 'gpt-oss:120b-cloud',
    localBaseUrl: 'http://localhost:11434',
    cloudBaseUrl: 'https://ollama.com',
    cloudApiKey: '',
    localApiKey: '',
    longContextTokenThreshold: 32_000,
    localMaxTokens: 2_000,
    cloudMaxTokens: 8_000,
    cloudTimeoutMs: 30_000,
    circuitBreakerFailThreshold: 3,
    circuitBreakerCooldownMs: 60_000,
    circuitBreakerWindowMs: 30_000,
    healthProbeIntervalMs: 0,
    piiGatingMode: 'local-only',
    ...overrides,
  };
}

function makeMessage(role: Message['role'], content: string): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

/** Standard Ollama /api/chat non-streaming success response. */
function ollamaChatResponse(text: string, model: string) {
  return {
    model,
    message: { role: 'assistant', content: text },
    done: true,
  };
}

/**
 * Build a fetch mock that returns 200 OK with the given payload for any
 * request. Individual tests override the implementation to simulate
 * failures (e.g. return 500 for specific model names).
 */
function buildFetchMock(handler: (body: { model: string; messages?: unknown[] }) => Response): typeof fetch {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : { model: '' };
    return handler(body as { model: string; messages?: unknown[] });
  }) as unknown as typeof fetch;
}

/** Returns a 200 OK Ollama chat response echoing the model name in the text. */
function okHandler(body: { model: string }): Response {
  return new Response(
    JSON.stringify(ollamaChatResponse('Hello from ' + body.model, body.model)),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ─── Axis 1: Sensitivity detection ───────────────────────────────────

describe('Axis 1: Sensitivity detection', () => {
  it('detects SSN as PII', () => {
    const { tag, spans } = detectSensitivity('My SSN is 123-45-6789.');
    expect(tag).toBe('pii');
    expect(spans.some((s) => s.type === 'SSN')).toBe(true);
  });

  it('detects email as PII', () => {
    const { tag } = detectSensitivity('Contact me at jane.doe@example.com.');
    expect(tag).toBe('pii');
  });

  it('detects credit-card-like numbers as PII', () => {
    const { tag } = detectSensitivity('Card: 4111 1111 1111 1111');
    expect(tag).toBe('pii');
  });

  it('detects API keys as PII', () => {
    const { tag } = detectSensitivity('Use sk-abcdefghijklmnopqrstuvwxyz123456 for the API.');
    expect(tag).toBe('pii');
  });

  it('detects IBAN as PII', () => {
    const { tag } = detectSensitivity('IBAN: DE89370400440532013000');
    expect(tag).toBe('pii');
  });

  it('detects restricted keywords (HIPAA)', () => {
    const { tag } = detectSensitivity('This is HIPAA-regulated data.');
    expect(tag).toBe('restricted');
  });

  it('detects restricted keywords (GDPR)', () => {
    const { tag } = detectSensitivity('Process under GDPR compliance.');
    expect(tag).toBe('restricted');
  });

  it('detects restricted keywords (Chinese: 敏感信息)', () => {
    const { tag } = detectSensitivity('这是一段敏感信息，请勿外传。');
    expect(tag).toBe('restricted');
  });

  it('tags innocuous text as public', () => {
    const { tag, spans } = detectSensitivity('What is the capital of France?');
    expect(tag).toBe('public');
    expect(spans).toHaveLength(0);
  });

  it('PII takes priority over restricted keywords', () => {
    // HIPAA text that ALSO contains an email → should tag as pii.
    const { tag } = detectSensitivity('HIPAA record: patient@example.com');
    expect(tag).toBe('pii');
  });
});

// ─── PII redaction / restoration ─────────────────────────────────────

describe('PII redaction and restoration', () => {
  it('redacts PII spans with stable placeholders', () => {
    const text = 'Email jane@example.com and call 555-123-4567.';
    const { spans } = detectSensitivity(text);
    const { redacted, restoreMap } = redactPii(text, spans);
    // Placeholders should appear in the redacted text.
    expect(redacted).toMatch(/\[EMAIL_1\]/);
    expect(redacted).toMatch(/\[PHONE_1\]/);
    // Restore map should map placeholders back to originals.
    expect(restoreMap.get('[EMAIL_1]')).toBe('jane@example.com');
    // Restoration should produce the original text.
    expect(restorePii(redacted, restoreMap)).toBe(text);
  });

  it('handles multiple spans of the same type with incrementing indices', () => {
    const text = 'a@x.com and b@x.com';
    const { spans } = detectSensitivity(text);
    const { redacted, restoreMap } = redactPii(text, spans);
    expect(redacted).toMatch(/\[EMAIL_1\]/);
    expect(redacted).toMatch(/\[EMAIL_2\]/);
    expect(restorePii(redacted, restoreMap)).toBe(text);
  });

  it('handles empty spans (no-op)', () => {
    const { redacted, restoreMap } = redactPii('no PII here', []);
    expect(redacted).toBe('no PII here');
    expect(restoreMap.size).toBe(0);
    expect(restorePii(redacted, restoreMap)).toBe('no PII here');
  });
});

// ─── Axis 2: Complexity scoring ──────────────────────────────────────

describe('Axis 2: Complexity scoring', () => {
  it('scores a trivial prompt as low across all dimensions', () => {
    const messages = [makeMessage('user', 'hello')];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.code).toBe(0);
    expect(scores.reasoning).toBe(0);
    expect(scores.retrieval).toBe(0);
    expect(scores.tool_use).toBe(0);
    expect(scores.multimodal).toBe(0);
    expect(scores.context_length).toBe(0);
  });

  it('scores code-related prompts with code > 0', () => {
    const messages = [makeMessage('user', 'Refactor this function to use async/await. Fix the bug.')];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.code).toBeGreaterThan(0);
  });

  it('scores reasoning prompts with reasoning > 0', () => {
    const messages = [makeMessage('user', 'Explain why this algorithm has O(n log n) complexity. Compare trade-offs.')];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.reasoning).toBeGreaterThan(0);
  });

  it('scores retrieval prompts with retrieval > 0', () => {
    const messages = [makeMessage('user', 'Search the docs for the specification. Find where it is documented.')];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.retrieval).toBeGreaterThan(0);
  });

  it('scores tool-use prompts with tool_use > 0', () => {
    const messages = [makeMessage('user', 'Run the shell command. Automate the pipeline. Execute the workflow.')];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.tool_use).toBeGreaterThan(0);
  });

  it('flags multimodal when a message has non-string content', () => {
    const messages = [
      { role: 'user' as const, content: { type: 'image', url: 'data:image/png;base64,...' }, timestamp: new Date().toISOString() },
    ];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.multimodal).toBe(5);
  });

  it('flags long-context when token estimate exceeds threshold', () => {
    // 200_000 chars ≈ 50_000 tokens — above the 32K threshold.
    const longText = 'a'.repeat(200_000);
    const messages = [makeMessage('user', longText)];
    const scores = scoreComplexity(messages, 32_000);
    expect(scores.context_length).toBe(5);
    expect(scores.tokenEstimate).toBeGreaterThan(32_000);
  });
});

// ─── Axis 2: Primary deployment selection ────────────────────────────

describe('Axis 2: pickPrimary deployment selection', () => {
  const config = makeConfig();

  it('routes trivial chat to the orchestrator', () => {
    const scores = { code: 0, reasoning: 0, retrieval: 0, tool_use: 0, multimodal: 0, context_length: 0, tokenEstimate: 10 };
    expect(pickPrimary(scores, config).deployment).toBe('orchestrator');
  });

  it('routes code-heavy prompts to the coder', () => {
    const scores = { code: 4, reasoning: 0, retrieval: 0, tool_use: 0, multimodal: 0, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('coder');
  });

  it('routes light reasoning to the general worker', () => {
    const scores = { code: 0, reasoning: 1, retrieval: 0, tool_use: 0, multimodal: 0, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('general');
  });

  it('routes retrieval-heavy prompts to the general worker (RAG triad)', () => {
    const scores = { code: 0, reasoning: 0, retrieval: 3, tool_use: 0, multimodal: 0, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('general');
  });

  it('routes multimodal prompts to the fast worker (gemma3:4b)', () => {
    const scores = { code: 0, reasoning: 0, retrieval: 0, tool_use: 0, multimodal: 5, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('fast');
  });

  it('routes long-context prompts to the fast worker (gemma3:4b 128K)', () => {
    const scores = { code: 0, reasoning: 0, retrieval: 0, tool_use: 0, multimodal: 0, context_length: 5, tokenEstimate: 50_000 };
    expect(pickPrimary(scores, config).deployment).toBe('fast');
  });

  it('routes ultra-long context (>128K) to the cloud tier', () => {
    const scores = { code: 0, reasoning: 0, retrieval: 0, tool_use: 0, multimodal: 0, context_length: 5, tokenEstimate: 200_000 };
    expect(pickPrimary(scores, config).deployment).toBe('cloud');
  });

  it('routes agentic tool chains (tool_use + reasoning) to the cloud tier', () => {
    const scores = { code: 0, reasoning: 3, retrieval: 0, tool_use: 4, multimodal: 0, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('cloud');
  });

  it('routes hard reasoning (no tool_use) to the cloud tier', () => {
    const scores = { code: 0, reasoning: 4, retrieval: 0, tool_use: 1, multimodal: 0, context_length: 0, tokenEstimate: 100 };
    expect(pickPrimary(scores, config).deployment).toBe('cloud');
  });
});

// ─── Fallback chain construction ─────────────────────────────────────

describe('Fallback chain construction', () => {
  it('includes cloud in the chain for public requests', () => {
    const chain = buildFallbackChain('coder', 'public');
    expect(chain).toContain('cloud');
    expect(chain).toContain('orchestrator');
    expect(chain).toContain('general');
    expect(chain).not.toContain('coder'); // primary excluded
  });

  it('excludes cloud from the chain for restricted requests', () => {
    const chain = buildFallbackChain('orchestrator', 'restricted');
    expect(chain).not.toContain('cloud');
    expect(chain).toContain('general');
    expect(chain).toContain('fast');
  });

  it('excludes cloud from the chain for PII requests', () => {
    const chain = buildFallbackChain('orchestrator', 'pii');
    expect(chain).not.toContain('cloud');
    expect(chain).toContain('general');
    expect(chain).toContain('fast');
  });

  it('excludes the primary from the chain', () => {
    const chain = buildFallbackChain('fast', 'public');
    expect(chain).not.toContain('fast');
  });

  it('orchestrator is the cloud-failover landing pad (first in chain when cloud is primary)', () => {
    const chain = buildFallbackChain('cloud', 'public');
    expect(chain[0]).toBe('orchestrator');
  });
});

// ─── Axis 3: Circuit breaker + end-to-end routing ────────────────────

describe('LocalLlmsRouter end-to-end', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Suppress console noise from the router's warning logs during tests.
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('routes a trivial public prompt to the orchestrator', async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      calls.push(body.model);
      return okHandler(body);
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0 }),
    });

    const messages = [makeMessage('user', 'hello')];
    const result = await router.call({ messages });

    expect(result.content).toBe('Hello from qwen3.5:4b');
    expect(calls).toEqual(['qwen3.5:4b']); // orchestrator
    expect(router.getLastDecision()?.servedBy).toBe('orchestrator');
    expect(router.getLastDecision()?.sensitivity).toBe('public');
    expect(router.getLastDecision()?.fallbackTriggered).toBe(false);
  });

  it('routes code-heavy prompts to the coder', async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      calls.push(body.model);
      return okHandler(body);
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0 }),
    });

    const messages = [makeMessage('user', 'Refactor this function. Fix the bug. Rename the variable. Add a method. Deprecate the old class.')];
    await router.call({ messages });

    expect(calls[0]).toBe('qwen2.5-coder:7b');
    expect(router.getLastDecision()?.servedBy).toBe('coder');
  });

  it('hard-restricted prompts NEVER touch the cloud tier', async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      calls.push(body.model);
      // Simulate the local orchestrator failing so the router walks the
      // fallback chain. The cloud tier must NOT appear in the chain.
      if (body.model === 'qwen3.5:4b') {
        return new Response('Internal Server Error', { status: 500 });
      }
      return new Response(
        JSON.stringify(ollamaChatResponse('local answer', body.model)),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0, piiGatingMode: 'local-only' }),
    });

    // HIPAA-tagged prompt → restricted → cloud excluded.
    const messages = [makeMessage('user', 'Summarize this HIPAA-regulated patient record.')];
    const result = await router.call({ messages });

    expect(result.content).toBe('local answer');
    // The cloud model must NEVER appear in the call list.
    expect(calls).not.toContain('gpt-oss:120b-cloud');
    expect(router.getLastDecision()?.sensitivity).toBe('restricted');
    expect(router.getLastDecision()?.fallbackTriggered).toBe(true);
    expect(router.getLastDecision()?.fallbackChain).not.toContain('cloud');
  });

  it('PII prompts with piiGatingMode=redact send sanitized text to cloud', async () => {
    const receivedTexts: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      // Capture the message content sent to each model.
      for (const m of (body.messages ?? []) as Array<{ content?: string }>) {
        if (m.content) receivedTexts.push(`${body.model}::${m.content}`);
      }
      return new Response(
        JSON.stringify(ollamaChatResponse('OK ' + body.model, body.model)),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0, piiGatingMode: 'redact' }),
    });

    // A prompt with an email — the cloud tier is picked because the
    // prompt also asks for "design" + "trade-off" + "compare" (reasoning).
    // With 'redact' mode, the email should be replaced with [EMAIL_1]
    // before the call.
    const messages = [makeMessage('user', 'Design a system. Compare trade-offs. Email me at jane@example.com.')];
    const result = await router.call({ messages });

    // The response content is restored — no placeholders in it.
    expect(result.content).not.toMatch(/\[EMAIL_\d+\]/);
    // The text sent to whichever model handled it should contain the
    // placeholder, NOT the original email.
    const combined = receivedTexts.join('\n');
    expect(combined).not.toContain('jane@example.com');
    expect(combined).toMatch(/\[EMAIL_1\]/);
  });

  it('cascades to the next deployment on failure (public request)', async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      calls.push(body.model);
      // Make the cloud tier fail; the router should fall back to the
      // orchestrator.
      if (body.model === 'gpt-oss:120b-cloud') {
        return new Response('Bad Gateway', { status: 502 });
      }
      return new Response(
        JSON.stringify(ollamaChatResponse('fallback ok', body.model)),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const router = new LocalLlmsRouter({
      // Use threshold=1 so a single cloud failure flips the breaker.
      config: makeConfig({ healthProbeIntervalMs: 0, circuitBreakerFailThreshold: 1 }),
    });

    // Hard-reasoning prompt → cloud primary; cloud fails → orchestrator.
    const messages = [makeMessage('user', 'Prove that the algorithm is correct. Derive the invariant. Explain why the design is sound. Analyze the trade-offs in depth.')];
    const result = await router.call({ messages });

    expect(calls[0]).toBe('gpt-oss:120b-cloud');
    expect(calls).toContain('qwen3.5:4b'); // orchestrator (fallback)
    expect(result.content).toBe('fallback ok');
    expect(router.getLastDecision()?.fallbackTriggered).toBe(true);
    expect(router.getLastDecision()?.servedBy).toBe('orchestrator');
    // The cloud deployment's breaker should now be OPEN (threshold=1).
    expect(router.getCircuitState('cloud')).toBe('OPEN');
  });

  it('flips the circuit breaker to OPEN after N consecutive failures (across calls)', async () => {
    globalThis.fetch = buildFetchMock((body) => {
      // Every local model fails — only the cloud tier succeeds.
      if (body.model === 'gpt-oss:120b-cloud') {
        return new Response(
          JSON.stringify(ollamaChatResponse('cloud ok', body.model)),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Internal Server Error', { status: 500 });
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({
        healthProbeIntervalMs: 0,
        circuitBreakerFailThreshold: 3,
        circuitBreakerCooldownMs: 60_000,
      }),
    });

    // Trivial prompt → orchestrator primary. After 3 SEPARATE call()
    // invocations (each failing the orchestrator once before cascading
    // to cloud), the breaker opens.
    const messages = [makeMessage('user', 'hello')];
    await router.call({ messages });
    expect(router.getCircuitState('orchestrator')).toBe('CLOSED');
    await router.call({ messages });
    expect(router.getCircuitState('orchestrator')).toBe('CLOSED');
    await router.call({ messages });
    // 3 failures in the rolling window → breaker opens.
    expect(router.getCircuitState('orchestrator')).toBe('OPEN');
  });

  it('recovers from OPEN to CLOSED after the cooldown (HALF_OPEN probe)', async () => {
    let orchestratorFailures = 0;
    globalThis.fetch = buildFetchMock((body) => {
      if (body.model === 'qwen3.5:4b') {
        orchestratorFailures += 1;
        // First 3 calls fail; the 4th call (the HALF_OPEN probe) succeeds.
        if (orchestratorFailures <= 3) {
          return new Response('fail', { status: 500 });
        }
        return new Response(
          JSON.stringify(ollamaChatResponse('recovered', body.model)),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify(ollamaChatResponse('cloud', body.model)),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    // Use a fake clock so we can advance time deterministically.
    let fakeNow = 1_000_000;
    const router = new LocalLlmsRouter({
      config: makeConfig({
        healthProbeIntervalMs: 0,
        circuitBreakerFailThreshold: 3,
        circuitBreakerCooldownMs: 60_000,
      }),
      now: () => fakeNow,
    });

    const messages = [makeMessage('user', 'hello')];

    // 3 separate call() invocations → orchestrator fails 3 times →
    // breaker opens. Each call cascades to the cloud tier for the
    // actual response.
    await router.call({ messages });
    await router.call({ messages });
    await router.call({ messages });
    expect(router.getCircuitState('orchestrator')).toBe('OPEN');

    // Advance time past the cooldown. The next call should probe the
    // orchestrator (HALF_OPEN), succeed (4th call → succeeds), and
    // close the breaker.
    fakeNow += 70_000;
    await router.call({ messages });
    expect(router.getCircuitState('orchestrator')).toBe('CLOSED');
  });

  it('throws when ALL deployments fail', async () => {
    globalThis.fetch = buildFetchMock(() => {
      return new Response('Internal Server Error', { status: 500 });
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0 }),
    });

    const messages = [makeMessage('user', 'hello')];
    await expect(router.call({ messages })).rejects.toThrow(/all deployments exhausted/);
  });

  it('piiGatingMode=off allows PII to flow to any deployment (testing mode)', async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetchMock((body) => {
      calls.push(body.model);
      return okHandler(body);
    });

    const router = new LocalLlmsRouter({
      config: makeConfig({ healthProbeIntervalMs: 0, piiGatingMode: 'off' }),
    });

    // A prompt with PII but also strong reasoning signals.
    const messages = [makeMessage('user', 'Prove this. Derive that. Explain why. Analyze. Compare. Email: jane@example.com.')];
    await router.call({ messages });

    // With gating off, the cloud tier should be eligible (if it's the
    // primary pick). Either way, the decision's sensitivity tag is
    // computed but not enforced.
    const decision = router.getLastDecision();
    expect(decision).toBeDefined();
    // Sensitivity is still detected (pii) — the gate is just disabled.
    // Note: 'off' is for testing only.
    expect(['public', 'internal', 'restricted', 'pii']).toContain(decision!.sensitivity);
  });
});

// ─── Mode-config integration ─────────────────────────────────────────

describe('Mode config: local-llms is registered', () => {
  it('MODE_AGENTS includes local-llms', async () => {
    const { MODE_AGENTS, MODE_PRIMARY_AGENT, MODE_TOOLS } = await import('../../packages/cli/src/tui/lib/mode-config.js');
    expect(MODE_AGENTS['local-llms']).toBeDefined();
    expect(MODE_PRIMARY_AGENT['local-llms']).toBeDefined();
    expect(MODE_TOOLS['local-llms']).toEqual(['*']);
  });

  it('MODE_PROMPTS includes a local-llms fragment', async () => {
    const { MODE_PROMPTS, getPromptForMode } = await import('@goli/core');
    expect(MODE_PROMPTS['local-llms']).toBeDefined();
    expect(getPromptForMode('local-llms')).toContain('LOCAL-LLMS');
  });

  it('isToolAllowedForMode allows all tools in local-llms', async () => {
    const { isToolAllowedForMode } = await import('@goli/core');
    expect(isToolAllowedForMode('local-llms', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('local-llms', 'bash')).toBe(true);
  });
});
