# How-to: Configure Multiple Providers

> **Goal:** Use a different LLM provider (Anthropic, OpenAI, Gemini,
> Ollama) instead of the default.

Goli-CLI supports five providers out of the box: Anthropic, OpenAI,
Google Gemini, Ollama (local + cloud), and a Mock provider for tests.
The provider is selected by the `GOLI_DEFAULT_MODEL` environment
variable.

## Set the default model

```bash
# Ollama Cloud (default — open-weight)
export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b-cloud"
export OLLAMA_API_KEY="sk-..."

# Anthropic
export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet"
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI
export GOLI_DEFAULT_MODEL="openai/gpt-4o"
export OPENAI_API_KEY="sk-..."

# Google Gemini
export GOLI_DEFAULT_MODEL="gemini/gemini-1.5-pro"
export GEMINI_API_KEY="..."

# Local Ollama (self-hosted)
export GOLI_DEFAULT_MODEL="ollama/llama3:70b"
export OLLAMA_BASE_URL="http://localhost:11434"
# No API key needed for local Ollama.
```

The model string format is `<provider>/<model-id>`. The provider prefix
is case-insensitive.

## Persist the config

Add the exports to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
echo 'export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet"' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc
```

## Per-session overrides

You can override the model for a single session with the `--model` flag:

```bash
goli wakeup --model openai/gpt-4o
```

Or in the TUI, use the `/model` slash command:

```
/model openai/gpt-4o
```

## Use a self-hosted OpenAI-compatible endpoint

If you run vLLM, LiteLLM, or any other OpenAI-compatible server, you
can route to it via the `openai/` prefix:

```bash
export GOLI_DEFAULT_MODEL="openai/llama3-70b"
export OPENAI_BASE_URL="http://localhost:8080/v1"
export OPENAI_API_KEY="dummy"  # vLLM doesn't check this, but the SDK requires it
```

See [ADR 0007](../../decisions/0007-openai-compatible-client.md) for
the rationale.

## Local-LLMs mode (PII gating + complexity routing)

If you have a mix of cloud and local models and want PII to stay
on-prem, use local-LLMs mode:

```bash
goli --local-llms -p "..."
```

This activates the `LocalLlmsRouter`, which:

- Detects PII (SSN, email, credit card, IBAN, API key, IPv4) in your
  prompt.
- If PII is found, routes to a local model (Ollama).
- If no PII, scores complexity and routes to the appropriate model
  (local for simple, cloud for complex).
- Falls back through a chain of models if one is unavailable (circuit
  breaker).

See [`docs/local-llms-mode.md`](../../local-llms-mode.md) for the full
guide.

## Verify the provider is working

```bash
goli status
```

The status output shows the current model, provider, and whether the
last request succeeded.

## Troubleshooting

- **"ANTHROPIC_API_KEY is not set"** — you forgot to export the env
  var. Run `echo $ANTHROPIC_API_KEY` to verify.
- **"Model not found"** — the model string is wrong. Check the
  provider's docs for the exact model ID.
- **"Connection refused"** — for local Ollama, make sure the server is
  running (`ollama serve`).
- **"401 Unauthorized"** — your API key is wrong or expired.

## See also

- [Reference: Environment variables](../reference/env-vars.md)
- [Reference: CLI flags](../reference/cli-flags.md)
- [How-to: Use local LLMs with PII gating](local-llms-pii-gating.md)
