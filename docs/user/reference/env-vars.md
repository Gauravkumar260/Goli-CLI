# Reference: Environment Variables

> Every environment variable Goli-CLI reads, with type, default, and
> description.

Env vars override TOML config (`GOLI_<SECTION>_<KEY>` pattern). They
are the primary way to configure Goli-CLI in CI / containers.

## Provider credentials

| Var                 | Required?              | Description                                         |
| ------------------- | ---------------------- | --------------------------------------------------- |
| `OLLAMA_API_KEY`    | Yes (for Ollama Cloud) | Ollama Cloud API key.                               |
| `OLLAMA_BASE_URL`   | No                     | Local Ollama URL. Default `http://localhost:11434`. |
| `ANTHROPIC_API_KEY` | Yes (for Anthropic)    | Anthropic API key.                                  |
| `OPENAI_API_KEY`    | Yes (for OpenAI)       | OpenAI API key.                                     |
| `OPENAI_BASE_URL`   | No                     | Override the OpenAI base URL (for vLLM / LiteLLM).  |
| `GEMINI_API_KEY`    | Yes (for Gemini)       | Google Gemini API key.                              |

## Model selection

| Var                            | Default               | Description              |
| ------------------------------ | --------------------- | ------------------------ |
| `GOLI_DEFAULT_MODEL`           | `ollama/gpt-oss:120b-cloud` | Default model string.    |
| `GOLI_DEFAULT_PROVIDER`        | (auto from model)     | Override the provider.   |
| `GOLI_DEFAULT_MODE`            | `build`               | Default app mode.        |
| `GOLI_DEFAULT_PERMISSION_MODE` | `ask`                 | Default permission mode. |

## Local-LLMs router

| Var                                                   | Default                       | Description                 |
| ----------------------------------------------------- | ----------------------------- | --------------------------- |
| `GOLI_LOCAL_LLMS_RESTRICTED_MODEL`                    | `ollama/llama3:70b`           | Model for PII prompts.      |
| `GOLI_LOCAL_LLMS_SIMPLE_MODEL`                        | `ollama/llama3:8b`            | Model for simple non-PII.   |
| `GOLI_LOCAL_LLMS_COMPLEX_MODEL`                       | `ollama/gpt-oss:120b-cloud`         | Model for complex non-PII.  |
| `GOLI_LOCAL_LLMS_CLOUD_FALLBACK`                      | `anthropic/claude-3-5-sonnet` | Cloud fallback.             |
| `GOLI_LOCAL_LLMS_PII_REDACT_MODEL`                    | `ollama/llama3:8b`            | Model for redaction pass.   |
| `GOLI_LOCAL_LLMS_OLLAMA_BASE_URL`                     | `http://localhost:11434`      | Local Ollama URL.           |
| `GOLI_LOCAL_LLMS_OLLAMA_CLOUD_BASE_URL`               | `https://api.ollama.com/v1`   | Ollama Cloud URL.           |
| `GOLI_LOCAL_LLMS_OLLAMA_CLOUD_API_KEY`                | `$OLLAMA_API_KEY`             | Ollama Cloud key.           |
| `GOLI_LOCAL_LLMS_COMPLEXITY_THRESHOLD_CLOUD`          | `7`                           | Complexity ≥ → cloud.       |
| `GOLI_LOCAL_LLMS_COMPLEXITY_THRESHOLD_LOCAL`          | `3`                           | Complexity < → small local. |
| `GOLI_LOCAL_LLMS_CIRCUIT_BREAKER_FAILURE_THRESHOLD`   | `5`                           | Failures to open.           |
| `GOLI_LOCAL_LLMS_CIRCUIT_BREAKER_RESET_TIMEOUT_MS`    | `60000`                       | Reset timeout.              |
| `GOLI_LOCAL_LLMS_CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS` | `3`                           | Half-open probes.           |
| `GOLI_LOCAL_LLMS_PII_GATING_MODE`                     | `redact`                      | `redact` or `block`.        |
| `GOLI_LOCAL_LLMS_HEALTH_PROBE_INTERVAL_MS`            | `30000`                       | Health probe interval.      |

## Sessions

| Var                                 | Default      | Description                        |
| ----------------------------------- | ------------ | ---------------------------------- |
| `GOLI_SESSIONS_DIR`                 | OS-dependent | Directory for JSONL session files. |
| `GOLI_SESSION_COMPACTION_THRESHOLD` | `0.7`        | Compact at 70% of context window.  |

## Sandbox

| Var                    | Default   | Description                                          |
| ---------------------- | --------- | ---------------------------------------------------- |
| `GOLI_SANDBOX`         | `1`       | Enable the sandbox. `0` disables (dev only).         |
| `GOLI_SANDBOX_PROFILE` | `default` | Sandbox profile (`default`, `strict`, `permissive`). |
| `GOLI_WORKSPACE_ROOT`  | cwd       | Workspace root (sandbox boundary).                   |

## Observability

| Var                                | Default    | Description                                            |
| ---------------------------------- | ---------- | ------------------------------------------------------ |
| `GOLI_LANGFUSE_BASE_URL`           | —          | Langfuse base URL.                                     |
| `GOLI_LANGFUSE_PUBLIC_KEY`         | —          | Langfuse public key.                                   |
| `GOLI_LANGFUSE_SECRET_KEY`         | —          | Langfuse secret key.                                   |
| `GOLI_OTEL_EXPORTER_OTLP_ENDPOINT` | —          | OTel OTLP endpoint.                                    |
| `GOLI_OTEL_SERVICE_NAME`           | `goli-cli` | OTel service name.                                     |
| `GOLI_LOG_LEVEL`                   | `info`     | Log level (`trace`, `debug`, `info`, `warn`, `error`). |

## i18n

| Var           | Default | Description                                    |
| ------------- | ------- | ---------------------------------------------- |
| `GOLI_LOCALE` | `$LANG` | Locale code (`en`, `de`, `es`, `ja`, `zh-CN`). |

## Theme

| Var          | Default        | Description                    |
| ------------ | -------------- | ------------------------------ |
| `GOLI_THEME` | `dark-default` | Theme name.                    |
| `NO_COLOR`   | —              | If set, use the NoColor theme. |

## Telemetry

| Var                       | Default | Description                                     |
| ------------------------- | ------- | ----------------------------------------------- |
| `GOLI_TELEMETRY_DISABLED` | `0`     | Disable all outbound calls except LLM provider. |
| `GOLI_TELEMETRY_ENDPOINT` | —       | Telemetry endpoint (override).                  |

## Audit log

| Var                           | Default | Description                    |
| ----------------------------- | ------- | ------------------------------ |
| `GOLI_AUDIT_LOG_PATH`         | —       | Audit log file path.           |
| `GOLI_AUDIT_LOG_TAMPER_CHECK` | `1`     | Verify chained hashes on load. |

## MCP

| Var                    | Default            | Description                               |
| ---------------------- | ------------------ | ----------------------------------------- |
| `GOLI_MCP_CONFIG_PATH` | `~/.goli/mcp.json` | MCP config file.                          |
| `GOLI_MCP_MODE`        | `0`                | Set to `1` when running as an MCP server. |

## Studio (web console)

| Var                     | Default                        | Description          |
| ----------------------- | ------------------------------ | -------------------- |
| `STUDIO_PORT`           | `3000`                         | Next.js app port.    |
| `STUDIO_RUNTIME_PORT`   | `3003`                         | Agent runtime port.  |
| `STUDIO_DATABASE_URL`   | `file:./db/custom.db`          | Prisma database URL. |
| `STUDIO_WORKSPACE_ROOT` | `/home/z/my-project/workspace` | Workspace root.      |

## See also

- [Reference: CLI flags](cli-flags.md)
- [Reference: Config format](config-format.md) — the TOML config that
  env vars override.
