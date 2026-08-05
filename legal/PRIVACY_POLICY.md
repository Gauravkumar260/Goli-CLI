# GOLI-CLI Privacy Policy

**Last Updated:** 2026-07-13
**Version:** 1.1

## 1. Overview

GOLI-CLI is an open-source AI coding agent. This Privacy Policy
describes what data GOLI-CLI collects, how it is used, and the
choices users have regarding their data.

## 2. Data Collected

### 2.1 Data Processed Locally (Not Transmitted)

The following data is processed on the user's local machine and is
NOT transmitted to any external service unless the user explicitly
configures an external observability backend:

- **File contents:** GOLI-CLI reads and writes files in the user's
  workspace as part of its normal operation. These contents are
  processed locally by the agent loop.
- **Command output:** Output from sandboxed commands (bash, grep, etc.)
  is processed locally.
- **Trajectory data:** The agent's conversation history, tool calls,
  and reasoning are stored locally in `~/.goli-cli/trajectories.jsonl`.
- **Audit log:** Every tool call and sandboxed command is logged to
  `~/.goli-cli/audit-log.jsonl` (locally).
- **Memory snapshots:** The 3-tier memory system (MEMORY.md, USER.md,
  PROJECT.md) is stored locally.

### 2.2 Data Transmitted to Model Providers

When the user runs the agent, the following data is transmitted to
the configured model provider (default: **Ollama Cloud** for the
`ollama/gpt-oss:120b` model — see `packages/core/src/providers/ollama.ts`.
Users may switch providers via the `GOLI_DEFAULT_MODEL` env var):

- **The full conversation history** (system prompt + user messages +
  assistant messages + tool results), up to the model's context window.
- **The reasoning effort** parameter (`low` / `high` / `max`).
- **Tool definitions** (so the model knows what tools are available).
- **Provider authentication** — the API key (e.g. `OLLAMA_API_KEY`,
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) is sent to
  the provider's auth endpoint, never logged, never written to disk.

**This data includes any file contents the agent has read**, including
source code, configuration files, and (if the user instructs the agent
to read them) secrets. GOLI-CLI's `block_secrets` hook prevents the
agent from reading common secret files, but users should review their
workspace before running the agent.

### 2.3 Data Transmitted to Observability Backends (Optional)

If the user configures Langfuse or another OTLP-compatible backend
(see `infra/`), the following data is transmitted to that backend:

- **Traces:** Per-iteration spans with timing, token counts, and tool
  call arguments.
- **Spans:** Per-tool-call spans with the tool name, arguments, and
  result (truncated to 500 chars).

**Users self-hosting Langfuse retain full control of this data.**
Users using a hosted Langfuse instance should review Langfuse's
privacy policy.

### 2.4 Data NOT Collected by GOLI-CLI

GOLI-CLI does NOT:

- Collect analytics or telemetry (the `LANGFUSE_DISABLE_TELEMETRY`
  flag is set in `infra/docker-compose.yml`).
- Phone home with usage statistics.
- Send crash reports to a central server.
- Track unique user IDs.
- Use advertising or tracking SDKs.

## 3. Data Retention

| Data Type       | Location                               | Default Retention            | Configurable?           |
| --------------- | -------------------------------------- | ---------------------------- | ----------------------- |
| Trajectory data | `~/.goli-cli/trajectories.jsonl`       | Until manually deleted       | Yes (SICA prune)        |
| Audit log       | `~/.goli-cli/audit-log.jsonl`          | Until manually deleted       | Yes (retentionDays)     |
| Crash snapshots | `~/.goli-cli/crash.json`               | Until next successful launch | No                      |
| Checkpoints     | `~/.goli-cli/checkpoints/`             | 7 days (auto-prune)          | Yes (retentionDays)     |
| Memory files    | `~/.goli-cli/{MEMORY,USER,PROJECT}.md` | Until manually deleted       | No                      |
| Langfuse traces | Configured backend                     | 30 days (default)            | Yes (Langfuse settings) |

## 4. Data Security

### 4.1 Sandboxing

All command execution is sandboxed (bubblewrap + Landlock on Linux,
sandbox-exec / Seatbelt on macOS). The sandbox prevents the agent from:

- Writing outside the workspace.
- Accessing the network except via the configured allowlist
  (`config/default.toml`, `[sandbox].networkAllowlist` — defaults to
  github.com / pypi.org / files.pythonhosted.org / registry.npmjs.org /
  crates.io on port 443).
- Reading sensitive system paths (`/etc`, `/var`, `~/.ssh`).
- Fork-bombing or exhausting memory/CPU/PIDs (cgroups v2 limits).

### 4.2 Secret Protection

The `block_secrets` hook denies reads of common secret files:

- `.env`, `.env.*`
- `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- `.aws/credentials`, `.ssh/*`
- `credentials.json`, `service-account*.json`

The audit log redacts secrets from logged commands:

- `Authorization: Bearer XXX` → `Authorization: Bearer [REDACTED]`
- `--token XXX` → `--token [REDACTED]`
- `SECRET=XXX` env vars → `SECRET=[REDACTED]`

Checkpoint snapshots exclude secret files via `DEFAULT_EXCLUDE_PATTERNS`.

### 4.3 API Key Storage

The model provider's API key is stored in:

- A provider-specific environment variable (e.g. `OLLAMA_API_KEY`,
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) — recommended.
- The `GOLI_DEFAULT_MODEL` env var (format: `<provider>/<model>`, e.g.
  `ollama/gpt-oss:120b`) — selects which provider is active.
- Optionally the `apiKey` field in `config/default.toml` or
  `~/.goli-cli/config.toml` (with `0600` permissions recommended).

GOLI-CLI does NOT store API keys in any other location, and never
logs them. The `block_secrets` hook additionally prevents the agent
from reading `.env` files at runtime.

## 5. User Choices

### 5.1 Choosing a Model Provider

Users can choose between:

- **Ollama Cloud (default)** — `ollama/gpt-oss:120b` open-weight model.
- **Hosted APIs** (Z.ai for GLM-5.2, DeepSeek, Together AI, Moonshot) —
  data is sent to the provider's servers.
- **Self-hosted vLLM** — data never leaves the user's infrastructure.
- **Mock provider** — `mock/echo` for offline / demo / CI use.

Switch via the `GOLI_DEFAULT_MODEL` env var (e.g.
`GOLI_DEFAULT_MODEL=anthropic/claude-3-5-sonnet`). See `infra/README.md`
for self-hosting instructions.

### 5.2 Disabling Observability

Users can disable trace export to Langfuse by:

- Not setting `GOLI_OBSERVABILITY_LANGFUSE_HOST`.
- Removing the `success_callback` and `failure_callback` lines from
  `infra/litellm/config.yaml`.

### 5.3 Disabling Trajectory Logging

Users can disable trajectory logging by:

- Setting `GOLI_MEMORY_TRAJECTORY_ENABLED=false` in the config.
- Deleting `~/.goli-cli/trajectories.jsonl`.

### 5.4 Disabling the Audit Log

The audit log CANNOT be disabled — it is a security control. Users
who need to delete audit entries (e.g., for GDPR right-to-erasure)
can delete `~/.goli-cli/audit-log.jsonl`, but this removes the
accountability trail.

### 5.5 Deleting All Data

To delete all GOLI-CLI data:

```bash
rm -rf ~/.goli-cli/
```

This removes trajectories, audit logs, crash snapshots, checkpoints,
and memory files. It does NOT remove data already transmitted to a
model provider or observability backend — users must contact those
providers separately.

## 6. GDPR and EU AI Act Compliance

### 6.1 GDPR

GOLI-CLI supports GDPR compliance via:

- **Data sovereignty:** Self-hosted vLLM keeps data within the EU.
- **Right to access:** All user data is in `~/.goli-cli/` (local).
- **Right to erasure:** `rm -rf ~/.goli-cli/`.
- **Data minimization:** The agent only reads files the user instructs
  it to read; the `block_secrets` hook minimizes secret exposure.

### 6.2 EU AI Act

GOLI-CLI supports EU AI Act compliance via:

- **Open-weight model:** The default `gpt-oss:120b` weights are
  auditable; users may also self-host via vLLM.
- **Audit log:** Every tool call is logged for accountability
  (`~/.goli-cli/audit-log.jsonl`, tamper-evident hash chain).
- **Human oversight:** The approval engine requires human approval
  for Tier-2+ actions (T2 risky, T3 destructive).
- **Risk management:** The blast-radius calculator
  (`packages/core/src/approval/blast-radius.ts`) classifies actions by
  risk before execution.
- **Transparency:** System prompt + tool definitions are inspectable
  via `/context` in the TUI.

## 7. Children's Privacy

GOLI-CLI is not directed at children under 16. We do not knowingly
collect personal information from children. If you believe a child
has provided us with personal information, please contact
privacy@goli-cli.dev.

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. The "Last
Updated" date at the top of this file indicates the most recent
revision.

## 9. Contact

For privacy questions or requests:

- Email: privacy@goli-cli.dev
- GitHub: https://github.com/goli-cli/goli-cli/issues

---

_This document is part of the GOLI-CLI compliance baseline. It is
not legal advice. Organizations deploying GOLI-CLI should have their
own privacy counsel review this policy and the accompanying
`TERMS_OF_SERVICE.md` and `SECURITY.md`._
