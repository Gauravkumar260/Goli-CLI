# ADR-0007: OpenAI-Compatible Client for GLM-5.2

**Status:** Accepted
**Phase:** P1 (documented); implemented in P2
**Date:** 2026-07-03

## Context

GLM-5.2 is the default model backend for GOLI-CLI. The model is served
via:

1. **Z.ai API** (Beijing-based) — for prototyping only. Subject to
   China's National Intelligence Law (Art. 7), Data Security Law, and
   Cybersecurity Law. NOT for production / enterprise use.
2. **Self-hosted vLLM** — the production posture. We serve `glm-5.2-fp8`
   weights on owned/leased GPU infra (8×H100/H200). Zero data egress.
3. **Third-party inference** (Together AI, Anyscale, etc.) — possible
   for scale-out, but requires a DPA and GDPR-compliant region.

We need a client API that works across all three without code changes.

## Decision

Use the **OpenAI-compatible Chat Completions API** as the wire format.

Rationale:

1. **vLLM speaks OpenAI-compatible.** The self-hosted production path
   is just a `base_url` swap from `https://open.bigmodel.cn/api/paas/v4`
   (Z.ai) to `https://vllm.internal:8000/v1` (self-hosted). No code
   changes.
2. **Z.ai speaks OpenAI-compatible.** The Z.ai API endpoint at
   `https://open.bigmodel.cn/api/paas/v4` accepts OpenAI-format
   requests. Verified in the upstream spec.
3. **Most third-party inference providers speak OpenAI-compatible.**
   Together AI, Anyscale, Fireworks, Replicate, OpenRouter — all of
   them accept OpenAI-format requests with a `base_url` swap.
4. **Tool calling is standardized.** The OpenAI tool-call schema
   (`tools: [{type: 'function', function: {name, description, parameters}}]`,
   response `tool_calls: [{id, type: 'function', function: {name, arguments}}]`)
   is the de facto standard, supported by vLLM and Z.ai.
5. **Streaming is standardized.** SSE-formatted `data: {chunk}` lines,
   with `choices[0].delta.content` / `delta.tool_calls` / `delta.reasoning_content`.

## What this is NOT

This is **NOT** a commitment to use the OpenAI SDK or to call OpenAI's
servers. Specifically:

- We do **not** import the `openai` npm package. We write a minimal
  fetch-based client (Phase 2) to avoid the SDK's opinionated defaults
  and to keep the SBOM minimal.
- We do **not** default `base_url` to `https://api.openai.com/v1`. The
  default is Z.ai for prototype; Phase 7 (Gate 3) switches to self-hosted
  vLLM.
- We do **not** support `gpt-4o`, `gpt-5`, `claude-3-5-sonnet`, or any
  other closed-weight model as default. The legal posture (ADR-0030 in
  Phase 13) is **open-weight-only routing**; closed-weight providers
  are hard-blocked in the routing config.

## Consequences

**Positive:**

- One client implementation covers all three deployment paths.
- Tool-call parsing is standardized (we don't need per-provider adapters).
- Streaming is standardized.
- The client is small (~200 lines of fetch + SSE parser + JSON repair).

**Negative:**

- The OpenAI tool-call JSON is occasionally malformed (the model emits
  partial JSON mid-stream, or forgets a closing brace). Mitigation: a
  defensive JSON parser with repair (Phase 2) — never let raw
  `JSON.parse` crash the loop.
- The `reasoning_content` field (for thinking tokens) is not yet
  standardized in the OpenAI spec — Z.ai and vLLM use slightly
  different field names. Mitigation: the client accepts both
  `reasoning_content` and `thinking` as aliases.
- We don't get to use Anthropic's nicer Messages API
  (system-as-top-level-field, content blocks, etc.). Tradeoff:
  portability wins.

## Implementation

- `src/agent/glm-client.ts` — Phase 2
- `GLMClient` class with `call(messages, tools, effort, stream)` method
- Streams `content` / `thinking` / `tool_calls` separately
- Defensive JSON parsing: `parseToolCallArgs(raw: string): { ok: true, value } | { ok: false, error }`
- Two reasoning-effort levels: `high` (default) / `max` (for tasks
  matching `complexTriggers` keywords)

## References

- OpenAI Chat Completions API: <https://platform.openai.com/docs/api-reference/chat>
- vLLM OpenAI-compatible server: <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>
- Z.ai API: <https://open.bigmodel.cn/dev/api>
- Upstream `module-1-agent-core-loop.md` — GLM-5.2 client section
