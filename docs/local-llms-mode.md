# Local-LLMs Mode (5th AppMode) — Three-Axis Router

`local-llms` is the 5th user-facing mode in GOLI-CLI, layered on top of the
existing 4 modes (`read-only`, `plan`, `build`, `god`). It wraps the agent
loop's model client in a three-axis router that selects the best model per
request from a pool of 4 local Ollama workers + 1 cloud tier, gated by
**sensitivity → complexity → availability** (in that order).

## TL;DR

```bash
# Headless — use the router for one prompt
goli --local-llms -p "Refactor the auth module to use JWT."

# Interactive — switch into local-llms from another mode
goli
> /mode local-llms
```

The mode is built on three orthogonal axes:

| Axis            | Type               | Effect                                                                                                                                                                                                     |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sensitivity  | **Hard gate**      | A Presidio-style PII/NER pass runs before any routing decision. `restricted` and `pii` tags structurally exclude the cloud tier. Configurable: `redact` (replace + restore) or `local-only` (force local). |
| 2. Complexity   | **Soft scorer**    | A lightweight classifier scores the request along `{code, reasoning, retrieval, tool_use, multimodal, context_length}`. The highest-scoring dimension picks the worker.                                    |
| 3. Availability | **Runtime filter** | Per-deployment circuit breaker (`CLOSED → OPEN → HALF_OPEN → CLOSED`). On failure, the call cascades DOWN the tier chain.                                                                                  |

## Worker pool

The router holds 5 `OllamaProvider` instances, each wrapped in a
`ProviderBackedModelClient`:

| ID             | Default model        | Role                                                                                                                                   | Context | Cloud?  |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- |
| `orchestrator` | `qwen3.5:4b`         | Always-resident. Routing/intent + cloud-failover landing pad (carries tool + thinking tokens).                                         | 32K     | no      |
| `coder`        | `qwen2.5-coder:7b`   | Code generation, refactor, docstrings.                                                                                                 | 32K     | no      |
| `general`      | `qwen3:4b`           | Reasoning + private-data RAG (thinking variant). Pair with `qwen3-embedding-0.6b` + `qwen3-reranker-0.6b` for the canonical RAG triad. | 32K     | no      |
| `fast`         | `gemma3:4b`          | Multimodal (image input) + 128K long-context. Output cap 8192 tokens.                                                                  | 128K    | no      |
| `cloud`        | `gpt-oss:120b-cloud` | Hard reasoning, agentic tool chains, ultra-long context (>128K). Offloaded to Ollama Cloud.                                            | 128K    | **yes** |

Pin all model tags — do not float to `:latest`. GGUF rebuilds shift quant
behavior. Override any model via env or TOML (see Configuration below).

## Routing decision matrix

| Scenario                                 | Sensitivity | Complexity     | Primary                           | Fallback chain                                            |
| ---------------------------------------- | ----------- | -------------- | --------------------------------- | --------------------------------------------------------- |
| Casual chat, intent classification       | public      | trivial        | `orchestrator`                    | `cloud → general → fast → coder`                          |
| Code completion, refactor                | public      | code           | `coder`                           | `cloud → orchestrator → general → fast`                   |
| Hard reasoning, agentic tool chains      | public      | reasoning+tool | `cloud`                           | `orchestrator → general → fast → coder`                   |
| Notes Q&A, text-only RAG                 | restricted  | retrieval      | `general`                         | `orchestrator → fast` (cloud excluded)                    |
| Image-aware RAG, OCR                     | restricted  | multimodal     | `fast`                            | `general → orchestrator` (cloud excluded)                 |
| Long-context summarization (>32K, ≤128K) | public      | long-context   | `fast`                            | `cloud → orchestrator → general`                          |
| Ultra-long context (>128K)               | public      | ultra-long     | `cloud`                           | `orchestrator → general` (only cloud has window)          |
| PII / regulated data, any task           | pii         | any            | `orchestrator` (cloud downgraded) | `general → fast` (cloud NEVER in chain)                   |
| Cloud provider flapping                  | any         | any            | (next in chain)                   | breaker opens after N fails; cloud retried after cooldown |

## Sensitivity axis (PII gating)

The router runs a Presidio-style regex pass over every message before any
routing decision. Detected patterns: SSN, credit card, email, phone, IBAN,
API keys (`sk-`, `pk-`, `AKIA`, `ghp_`, `xoxb_`, etc.), IPv4 addresses.
Restricted keywords (HIPAA, GDPR, PCI-DSS, SOX, PHI, PII, "confidential",
"敏感信息", "机密", etc.) tag the request as `restricted` even without a
specific PII regex hit.

Two gating modes (configurable via `piiGatingMode`):

- **`local-only` (default)**: restricted/PII payloads are hard-gated to local
  workers. Cloud is structurally excluded — not just deprioritized.
- **`redact`**: sensitive spans are replaced with stable placeholders
  (`[EMAIL_1]`, `[SSN_2]`, etc.) before the call, then restored in the
  response. Use this when the cloud tier is the only one with enough context
  window for a restricted payload.
- **`off`**: sensitivity axis disabled (testing only).

The sensitivity tag is computed by the router's pre-call hook — never
trusted from the client. A client claiming `public` on a prompt containing
SSNs is re-tagged `pii` by the NER pass and forced local.

## Complexity axis

A lightweight classifier scores the request along 6 dimensions
(`{code, reasoning, retrieval, tool_use, multimodal, context_length}`).
Each dimension is a count of keyword hits (capped at 5). The
highest-scoring dimension picks the worker (see `pickPrimary` in
`local-llms-router.ts` for the priority rules).

This mirrors the HyDRA predictor → profile → shortfall-matching flow, with
sensitivity layered in as a pre-filter. The classifier is decoupled from
the model catalog — adding a future `qwen3-coder:7b` or a second cloud
tier is a config + profile change, not a retrain.

## Availability axis (circuit breaker)

Each deployment has its own circuit breaker:

```
CLOSED → OPEN         (N fails in W ms — default 3 fails / 30 s)
OPEN   → HALF_OPEN    (after cooldown — default 60 s)
HALF_OPEN → CLOSED    (single probe succeeds)
HALF_OPEN → OPEN      (probe fails)
```

On failure, the router cascades DOWN the tier chain. The cascade direction
is **always down-tier** for restricted requests (never up to cloud), and
**down-tier on failure** for public requests: `cloud → orchestrator →
general → fast → coder`. The orchestrator is the designated cloud-failover
landing pad precisely because it carries tool-call and thinking tokens.

Context-window fallback: if a request exceeds a worker's context budget,
the router promotes to the next candidate with sufficient window
(`gemma3:4b` at 128K, then `gpt-oss:120b-cloud`).

## Configuration

All knobs live under `[localLlms]` in `config/default.toml` (or
`~/.goli-cli/config.toml`). Env overrides use `GOLI_LOCAL_LLMS_<KEY>`:

```bash
# Override the orchestrator model
GOLI_LOCAL_LLMS_ORCHESTRATOR_MODEL=qwen3.5:4b

# Set the cloud tier API key
GOLI_LOCAL_LLMS_CLOUD_API_KEY=sk-...

# Switch PII gating to redact-and-restore mode
GOLI_LOCAL_LLMS_PII_GATING_MODE=redact

# Tighten the circuit breaker
GOLI_LOCAL_LLMS_CIRCUIT_BREAKER_FAIL_THRESHOLD=2
```

Full TOML example:

```toml
[localLlms]
orchestratorModel = "qwen3.5:4b"
coderModel        = "qwen2.5-coder:7b"
generalModel      = "qwen3:4b"
fastModel         = "gemma3:4b"
cloudModel        = "gpt-oss:120b-cloud"
localBaseUrl      = "http://localhost:11434"
cloudBaseUrl      = "https://ollama.com"

longContextTokenThreshold = 32000
localMaxTokens            = 2000
cloudMaxTokens            = 8000
cloudTimeoutMs            = 30000

circuitBreakerFailThreshold = 3
circuitBreakerCooldownMs    = 60000
circuitBreakerWindowMs      = 30000
healthProbeIntervalMs       = 30000

piiGatingMode = "local-only"
```

## VRAM budgeting on a 16 GB GPU

Keep `qwen3.5:4b` (~3.4 GB) + `qwen2.5-coder:7b` (~4.5 GB) + `qwen3:4b`
(~3 GB) resident (~10.9 GB) and lazy-load `gemma3:4b` only on
multimodal/long-ctx paths. Below 16 GB, drop `qwen3:4b` to lazy-load and
keep only orchestrator + coder resident.

The router does not currently manage residency itself — pre-warm
Ollama workers on boot (`/api/generate` with empty prompt) to eliminate
first-routed-call cold-start. A future revision of the router will respect
the configured health-probe interval to refresh the residency cache.

## Operational gotchas

- **Thinking-mode tax.** Both `qwen3.5:4b` and `qwen3:4b` ship with thinking
  on by default; on simple prompts this 2–4× latency hit will dominate p95.
  Profile and toggle per route, not globally.
- **Quant floor.** Do not drop `qwen2.5-coder:7b` below Q4_K_M — code
  quality degrades measurably at Q3, and tool-call format adherence drops
  below ~95%.
- **Cloud-offload latency.** `gpt-oss:120b-cloud` is not a local 120B — it
  round-trips to Ollama's cloud. First-call latency after idle can hit
  5–10 s; pre-warm on a 5-min heartbeat.
- **Catalog drift.** The router's complexity classifier is decoupled from
  the model catalog — adding a future `qwen3-coder:7b` or a second cloud
  tier is a config + profile change, not a retrain. Keep your model
  capability profiles in version control alongside the router config.

## Observability

Every routing decision is logged at `debug` level with attributes:
`selected_model`, `sensitivity_tag`, `complexity_scores.*`,
`circuit_state_per_deployment`, `fallback_triggered`, `latency_ms`,
`tier`. The full `RoutingDecision` object is also available
programmatically via `router.getLastDecision()` (used by the tests).

A future revision will emit one OpenTelemetry span per routing decision,
sunk into Langfuse / Phoenix / Arize. The two derived metrics to track:
**routing accuracy** (sampled LLM-as-judge on whether the chosen model
satisfied the request) and **cost split** (cloud token-spend vs local
GPU-seconds).

## Architecture

The router mirrors the existing `EffortRoutingClient` pattern: it
implements the `ModelCallable` interface (same `call()` signature), holds
an inner pool of `ModelCallable` clients (each a `ProviderBackedModelClient`
wrapping an `OllamaProvider`), and delegates `call()` to the chosen inner
client. This makes it composable with the existing agent loop without
touching the loop's contract.

```
                ┌─────────────────────────────────────────┐
                │           AgentLoop (loop.ts)           │
                │  this.client = LocalLlmsRouter (when    │
                │    appMode === 'local-llms')            │
                └───────────────────┬─────────────────────┘
                                    │ call({messages, tools, effort, ...})
                                    ▼
                ┌─────────────────────────────────────────┐
                │         LocalLlmsRouter                  │
                │  ────────────────────────────────────── │
                │  Axis 1: detectSensitivity() → tag      │
                │  Axis 2: scoreComplexity() → primary    │
                │  Axis 3: circuit breaker + cascade      │
                │                                         │
                │  Pool: 5 ProviderBackedModelClient      │
                │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐               │
                │  │orc│ │cod│ │gen│ │fst│ │cld│           │
                │  └──┘ └──┘ └──┘ └──┘ └──┘               │
                └─────────────────────────────────────────┘
                                    │ HTTP POST /api/chat
                                    ▼
                            local Ollama + cloud
```

## Files added/modified

| File                                            | Status | Purpose                                                                           |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `packages/core/src/agent/local-llms-router.ts`  | NEW    | Three-axis router + sensitivity detector + complexity scorer + circuit breaker    |
| `packages/core/src/config/mode-prompts.ts`      | MOD    | Added `'local-llms'` to `AppMode` union + `MODE_PROMPTS` + `isToolAllowedForMode` |
| `packages/core/src/config/schema.ts`            | MOD    | Added `LocalLlmsConfigSchema` + `localLlms` field on `AppConfigSchema`            |
| `packages/core/src/agent/loop.ts`               | MOD    | Wired `LocalLlmsRouter` as the loop's client when `appMode === 'local-llms'`      |
| `packages/core/src/agent/index.ts`              | MOD    | Exported `LocalLlmsRouter` + types                                                |
| `packages/core/src/index.ts`                    | MOD    | Re-exported `LocalLlmsRouter`, `LocalLlmsConfig`, `isToolAllowedForMode`          |
| `packages/cli/src/tui/theme/agents.ts`          | MOD    | Added `'local-llms'` to `AppMode`, `MODES`, `modeToTierId/RunMode/PermissionMode` |
| `packages/cli/src/tui/lib/mode-config.ts`       | MOD    | Added `'local-llms'` to all 5 mode registries                                     |
| `packages/cli/src/tui/lib/CommandRegistry.ts`   | MOD    | Added `'local-llms'` to `/mode` slash command validation                          |
| `packages/cli/src/tui/components/SplashBox.tsx` | MOD    | Added `'local-llms'` mode label                                                   |
| `packages/cli/src/tui/components/App.tsx`       | MOD    | Added `'local-llms'` entry to `APPMODE_TO_INDICATOR`                              |
| `packages/cli/src/services/CliAgentLoop.ts`     | MOD    | `'local-llms'` permission handling (same as build)                                |
| `packages/cli/src/index.ts`                     | MOD    | Added `--local-llms` CLI flag, threaded to `runHeadless`                          |
| `packages/cli/src/commands/types.ts`            | MOD    | Added `localLlms?: boolean` to `GlobalOptions`                                    |
| `config/default.toml`                           | MOD    | Added `[localLlms]` section                                                       |
| `tests/unit/local-llms-router.test.ts`          | NEW    | 46 tests covering all three axes + PII redaction + end-to-end routing             |
| `tests/unit/cli-args.test.ts`                   | MOD    | Added `localLlms` extraction test                                                 |
