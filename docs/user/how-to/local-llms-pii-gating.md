# How-to: Use Local LLMs with PII Gating

> **Goal:** Run Goli-CLI with local LLMs for PII-sensitive prompts and
> cloud LLMs for the rest, automatically.

If you work in a regulated industry (finance, health, EU) or just
prefer to keep PII on your own machine, Goli-CLI's **local-LLMs mode**
automatically routes prompts based on:

1. **PII sensitivity** — if the prompt contains an SSN, email, credit
   card, IBAN, API key, or IPv4, route to a local model.
2. **Complexity** — if the prompt is a simple syntax question, route to
   a small local model; if it's a complex refactor, route to a large
   cloud model.
3. **Availability** — if the chosen model is down (circuit breaker OPEN),
   fall back through a chain.

## Prerequisites

- A local Ollama server with at least one model installed
  (`ollama pull llama3:70b`).
- An Ollama Cloud account (for the cloud tier).
- Optionally, an Anthropic / OpenAI / Gemini API key for the cloud
  fallback.

## Step 1: Configure the local-LLMs router

Edit `config/default.toml` (or create `~/.goli/config.toml`):

```toml
[localLlms]
# The 5 models in the chain (in priority order)
restricted_model = "ollama/llama3:70b"        # for PII prompts
simple_model = "ollama/llama3:8b"              # for simple non-PII
complex_model = "ollama/gpt-oss:120b"          # for complex non-PII (cloud)
cloud_fallback = "anthropic/claude-3-5-sonnet" # if complex is down
pii_redact_model = "ollama/llama3:8b"          # for redaction pass

# Endpoints
ollama_base_url = "http://localhost:11434"
ollama_cloud_base_url = "https://api.ollama.com/v1"
ollama_cloud_api_key = "${OLLAMA_API_KEY}"

# Complexity thresholds (0-10 scale, 6 dimensions)
[localLlms.complexity_thresholds]
cloud = 7  # complexity ≥ 7 → cloud
local = 3  # complexity < 3 → small local
# 3 ≤ complexity < 7 → large local

# Circuit breaker
[localLlms.circuit_breaker]
failure_threshold = 5
reset_timeout_ms = 60000
half_open_max_calls = 3

# PII gating mode: "redact" (default) or "block"
pii_gating_mode = "redact"
```

## Step 2: Run in local-LLMs mode

```bash
goli --local-llms -p "What's the SSN 123-45-6789 for?"
```

You'll see a log message:

```
[local-llms-router] PII detected (SSN) → routing to ollama/llama3:70b (restricted)
```

The prompt goes to the local model; the cloud is never called.

## Step 3: Verify PII redaction

For prompts with PII that must go to the cloud (e.g. a complex
refactor involving a real email), the router redacts the PII first:

```bash
goli --local-llms -p "Refactor the function that processes user@example.com and returns their balance."
```

Log:

```
[local-llms-router] PII detected (email) → redacting
[local-llms-router] Redacted: user@example.com → [EMAIL_1]
[local-llms-router] Complexity: 8/10 → routing to anthropic/claude-3-5-sonnet (cloud)
[local-llms-router] Tool result contains [EMAIL_1] placeholder → restoring to user@example.com
```

The cloud model sees `[EMAIL_1]` instead of the real email. When the
agent's tool result comes back, the router restores the placeholder
to the real email.

## Step 4: Monitor the circuit breaker

If a model is consistently failing, the circuit breaker opens:

```
[local-llms-router] ollama/llama3:70b: 5 failures in a row → OPEN
[local-llms-router] Falling back to anthropic/claude-3-5-sonnet
```

The circuit breaker resets after `reset_timeout_ms` (60s by default)
and tries `half_open_max_calls` (3 by default) requests before fully
closing.

## PII patterns detected

The router detects:

| Pattern             | Regex                                                           |
| ------------------- | --------------------------------------------------------------- |
| SSN                 | `\b\d{3}-\d{2}-\d{4}\b`                                         |
| Email               | `[\w.-]+@[\w.-]+\.\w+`                                          |
| Credit card         | `\b(?:\d[ -]*?){13,16}\b` (with Luhn check)                     |
| IBAN                | `[A-Z]{2}\d{2}[A-Z0-9]{11,30}`                                  |
| API key (common)    | `(?:sk-                                                         | sk-ant- | sk-...)[a-zA-Z0-9]{20,}` |
| IPv4                | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`                        |
| Restricted keywords | configurable; default: `password`, `secret`, `token`, `api_key` |

## Gating modes

| Mode               | Behavior                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `redact` (default) | PII is replaced with `[TYPE_N]` placeholders before sending to cloud; restored in tool results. |
| `block`            | If PII is detected, the prompt is blocked from going to the cloud; only local models are used.  |

Use `block` if your compliance team requires PII to never leave the
machine, even as redacted placeholders.

## See also

- [`docs/local-llms-mode.md`](../../local-llms-mode.md) — the full
  user guide.
- [ADR: local-LLMs router](../../decisions/) — the design decision
  (see worklog entry `MERGE-studio-into-monorepo` for context).
- [How-to: Configure providers](configure-providers.md) — basic
  provider setup.
