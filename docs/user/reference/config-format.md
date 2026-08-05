# Reference: Config File Format (TOML)

> Complete reference for `~/.goli/config.toml` and `config/default.toml`.

Goli-CLI uses TOML for configuration (see
[ADR 0006](../../decisions/0006-toml-config-format.md) for the
rationale). The config is loaded in this order (later overrides
earlier):

1. `config/default.toml` (in the repo) — defaults.
2. `~/.goli/config.toml` — user-wide.
3. `./.goli/config.toml` — project-local.
4. Environment variables (`GOLI_<SECTION>_<KEY>`).

## Schema

The full schema is defined in Zod at
`packages/core/src/config/schema.ts`. Below is a human-readable
summary.

### `[model]`

```toml
[model]
default = "ollama/gpt-oss:120b"           # default model string
provider = "ollama"                        # default provider (auto from model)
mode = "build"                             # build | plan | god | local-llms
permission_mode = "ask"                    # ask | yolo | plan
```

### `[workspace]`

```toml
[workspace]
root = "."                                  # workspace root (sandbox boundary)
```

### `[sessions]`

```toml
[sessions]
dir = "~/.goli/sessions"                    # JSONL session directory
compaction_threshold = 0.7                  # compact at 70% of context window
```

### `[sandbox]`

```toml
[sandbox]
enabled = true                              # enable the kernel sandbox
profile = "default"                         # default | strict | permissive
```

### `[audit_log]`

```toml
[audit_log]
path = "/var/log/goli/audit.jsonl"          # audit log file path
tamper_check = true                         # verify chained hashes on load
```

### `[local_llms]`

```toml
[local_llms]
restricted_model = "ollama/llama3:70b"      # for PII prompts
simple_model = "ollama/llama3:8b"           # for simple non-PII
complex_model = "ollama/gpt-oss:120b"       # for complex non-PII (cloud)
cloud_fallback = "anthropic/claude-3-5-sonnet"
pii_redact_model = "ollama/llama3:8b"

ollama_base_url = "http://localhost:11434"
ollama_cloud_base_url = "https://api.ollama.com/v1"
ollama_cloud_api_key = "${OLLAMA_API_KEY}"   # env var interpolation

pii_gating_mode = "redact"                  # redact | block

[local_llms.complexity_thresholds]
cloud = 7                                    # complexity ≥ 7 → cloud
local = 3                                    # complexity < 3 → small local

[local_llms.circuit_breaker]
failure_threshold = 5
reset_timeout_ms = 60000
half_open_max_calls = 3

[local_llms.health_probe]
interval_ms = 30000
```

### `[observability]`

```toml
[observability]
log_level = "info"                          # trace | debug | info | warn | error

[observability.langfuse]
base_url = "https://langfuse.example.com"
public_key = "pk-lf-..."
secret_key = "sk-lf-..."

[observability.otel]
exporter_otlp_endpoint = "http://otel-collector:4318"
service_name = "goli-cli"
```

### `[i18n]`

```toml
[i18n]
locale = "en"                               # en | de | es | ja | zh-CN
```

### `[theme]`

```toml
[theme]
name = "dark-default"                       # theme name
```

### `[hooks]`

```toml
# Hook entries — array of tables
[[hooks]]
event = "BeforeTool"                        # BeforeTool | AfterTool | ...
path = "~/.goli/hooks/no-sudo.ts"
tools = ["bash"]                            # restrict to these tools

[[hooks]]
event = "AfterTool"
path = "~/.goli/hooks/log-tool-call.ts"
```

### `[mcp]`

```toml
[mcp]
config_path = "~/.goli/mcp.json"            # MCP server config
```

### `[permissions]`

```toml
[permissions]
default_mode = "ask"                        # ask | yolo | plan

# Per-tool overrides
[permissions.tools]
bash = "ask"                                # always ask for bash
write_file = "ask"                          # always ask for writes
read_file = "allow"                         # always allow reads
```

## Env var interpolation

Config values can reference env vars with `${VAR_NAME}`:

```toml
[local_llms]
ollama_cloud_api_key = "${OLLAMA_API_KEY}"
```

If the env var is not set, the value is empty (not an error). Use
`${VAR_NAME:-default}` for a default:

```toml
[model]
default = "${GOLI_DEFAULT_MODEL:-ollama/gpt-oss:120b}"
```

## Validation

The config is validated against a Zod schema on load
(`packages/core/src/config/schema.ts`). Invalid configs fail fast
with a clear error:

```
Config validation error:
  at local_llms.complexity_thresholds.cloud: expected number ≥ 0, got "high"
  at audit_log.path: expected string, got undefined
```

## Policy file integrity

If a `policy.toml` is loaded via `--policy path/to/policy.toml`,
Goli-CLI computes its SHA-256 hash and stores it. On subsequent loads,
the hash is verified; a mismatch is a `POLICY_VIOLATION` (exit 5).
See [ADR for policy integrity](../../decisions/) and
[`tests/unit/policy-integrity-t064.test.tsx`](../../../tests/unit/policy-integrity-t064.test.tsx).

## See also

- [Reference: Environment variables](env-vars.md)
- [Reference: CLI flags](cli-flags.md)
- [ADR 0006](../../decisions/0006-toml-config-format.md) — TOML choice.
- [`config/default.toml`](../../../config/default.toml) — the default
  config file.
