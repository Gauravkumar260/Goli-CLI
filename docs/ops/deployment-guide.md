# Deployment Guide — Goli-CLI

> **Audience:** DevOps engineers deploying Goli-CLI in production
> (self-hosted, regulated, or enterprise).
> **Last updated:** 2026-07-25

This guide covers the four deployment patterns for Goli-CLI:

1. **Single-user local** — a developer running `goli` on their laptop.
2. **Team self-hosted** — a team sharing a Goli-CLI deployment with
   Langfuse + LiteLLM + vLLM.
3. **Enterprise on-prem** — a regulated industry deploying Goli-CLI
   in their own k8s cluster with no external dependencies.
4. **CI/CD integration** — Goli-CLI running in CI pipelines for code
   review and test generation.

For the Studio (web console), see
[Tutorial: Running Goli Studio](../user/tutorials/running-studio.md)
and [How-to: Self-host with k8s](../user/how-to/self-host-k8s.md).

## 1. Single-user local

### 1.1 Install

```bash
# Option A: npx (no install)
npx goli-cli --help

# Option B: global install
npm install -g goli-cli

# Option C: from source (for development)
git clone https://github.com/goli-cli/goli-cli
cd goli-cli
npm install
npm run build
npm link
```

### 1.2 Configure

```bash
# Set your LLM provider
export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b"   # default — open-weight
export OLLAMA_API_KEY="sk-..."

# Or use a closed-weight provider
# export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet"
# export ANTHROPIC_API_KEY="sk-ant-..."

# Optional: set workspace root (sandbox boundary)
export GOLI_WORKSPACE_ROOT="$HOME/my-project"
```

Add to `~/.zshrc` / `~/.bashrc` for persistence.

### 1.3 Run

```bash
goli wakeup            # start the TUI
goli -p "..."          # headless one-shot
```

### 1.4 Verify

```bash
goli doctor            # diagnose common issues
goli status            # system status
```

## 2. Team self-hosted (with vLLM + LiteLLM + Langfuse)

For a team that wants to share a self-hosted LLM endpoint and a
shared trace dashboard.

### 2.1 Prerequisites

- A Linux server with 1× A100 80GB (or 4× A10G) for vLLM.
- Docker 24+ and Docker Compose 2.20+.
- A domain name (for HTTPS via Caddy).

### 2.2 Deploy the stack

```bash
git clone https://github.com/goli-cli/goli-cli
cd goli-cli/infra

# Edit docker-compose.yml: set your domain, model, etc.
$EDITOR docker-compose.yml

# Start the stack
docker compose up -d
```

This starts:

- **vLLM** on port 8000 (serving `gpt-oss:120b` on GPU).
- **LiteLLM** on port 4000 (LLM gateway with audit log).
- **Langfuse** on port 3000 (trace dashboard).
- **Postgres** on port 5432 (Langfuse backing store).
- **ClickHouse** on port 8123 (Langfuse analytics).
- **Caddy** on ports 80/443 (reverse proxy with auto-HTTPS).

### 2.3 Configure Goli-CLI clients

Each team member configures their local Goli-CLI to point at the
self-hosted stack:

```bash
export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b"
export OPENAI_BASE_URL="https://litellm.your-domain.com/v1"
export OPENAI_API_KEY="<litellm-master-key>"

export GOLI_LANGFUSE_BASE_URL="https://langfuse.your-domain.com"
export GOLI_LANGFUSE_PUBLIC_KEY="pk-lf-..."
export GOLI_LANGFUSE_SECRET_KEY="sk-lf-..."
```

### 2.4 Verify

```bash
goli -p "hello" --debug
# Logs should show requests going to litellm.your-domain.com

# Open https://langfuse.your-domain.com — you should see your run.
```

### 2.5 Backups

- **Postgres**: `pg_dump langfuse | gzip > langfuse-$(date +%F).sql.gz`
  daily.
- **ClickHouse**: `clickhouse-backup` (or your managed backup).
- **Goli-CLI sessions** (per user): `~/.goli/sessions/*.jsonl` —
  users back up their own.

## 3. Enterprise on-prem (k8s, no external deps)

For a regulated industry that cannot use any external service. See
[How-to: Self-host with k8s](../user/how-to/self-host-k8s.md) for
the full guide.

Summary:

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/postgres.yaml
kubectl apply -f infra/k8s/clickhouse.yaml
kubectl apply -f infra/k8s/secrets.yaml       # edit first!
kubectl apply -f infra/k8s/langfuse.yaml
kubectl apply -f infra/k8s/vllm.yaml
kubectl apply -f infra/k8s/litellm.yaml
```

For production hardening (managed Postgres, HPA, backups,
monitoring), see the [how-to](../user/how-to/self-host-k8s.md#production-hardening).

## 4. CI/CD integration

For using Goli-CLI in CI pipelines (code review, test generation),
see [How-to: Run Goli-CLI in CI](../user/how-to/ci-headless-mode.md).

Summary:

```yaml
# .github/workflows/ai-review.yml
- run: npm install -g goli-cli
- run: |
    goli -p "Review this PR for bugs." \
      --headless-output json \
      --permission-mode plan \
      --no-telemetry
  env:
    GOLI_DEFAULT_MODEL: anthropic/claude-3-5-sonnet
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## 5. Configuration management

For all deployment patterns, configuration is via:

1. **TOML config file** (`~/.goli/config.toml`) — see
   [Reference: Config format](../user/reference/config-format.md).
2. **Environment variables** — override TOML; see
   [Reference: Environment variables](../user/reference/env-vars.md).
3. **CLI flags** — override env vars; see
   [Reference: CLI flags](../user/reference/cli-flags.md).

For teams, the recommended pattern is:

- A `config/team.toml` checked into the team's infra repo.
- Each member has `~/.goli/config.toml` with personal overrides
  (e.g. theme, locale).
- CI uses env vars only (no config file).

## 6. Monitoring

### 6.1 Health checks

```bash
# CLI health
goli doctor

# Provider health (for self-hosted vLLM)
curl http://vllm.your-domain.com/health

# Langfuse health
curl http://langfuse.your-domain.com/api/health
```

### 6.2 Logs

- **CLI** — `~/.goli/logs/goli.log` (rotate daily).
- **vLLM** — Docker logs: `docker compose logs vllm`.
- **LiteLLM** — Docker logs: `docker compose logs litellm`.
- **Langfuse** — Docker logs: `docker compose logs langfuse`.

### 6.3 Metrics

- **vLLM** — Prometheus endpoint at `:8000/metrics`.
- **LiteLLM** — Prometheus endpoint at `:4000/metrics`.
- **Langfuse** — built-in dashboard at
  `https://langfuse.your-domain.com/dashboard`.

### 6.4 Tracing

Every Goli-CLI run emits OTel traces to Langfuse. Use Langfuse to:

- See the full trajectory of a run (prompt, tool calls, responses,
  latency).
- Compare runs side-by-side.
- Filter by model, by user, by tag.
- Set up alerts on error rate or latency.

## 7. Upgrading

See [Migration Guides](migration-guides/) for version-specific
upgrade instructions. General process:

1. Read the migration guide for the target version.
2. Back up `~/.goli/` (sessions, config, registry).
3. `npm update -g goli-cli` (or `git pull && npm install` if from
   source).
4. `goli doctor` to verify.
5. Run a small test prompt: `goli -p "hello" --headless-output json`.
6. If all good, resume normal use.

For self-hosted stacks, see `infra/UPGRADE.md` (planned).

## 8. Uninstalling

```bash
# Remove the global install
npm uninstall -g goli-cli

# (Optional) remove user data
rm -rf ~/.goli/

# (Optional) for self-hosted, take down the stack
cd infra
docker compose down -v   # -v removes volumes (DATA LOSS)
```

## 9. See also

- [`infra/README.md`](../../infra/README.md)
- [`infra/docker-compose.yml`](../../infra/docker-compose.yml)
- [How-to: Self-host with k8s](../user/how-to/self-host-k8s.md)
- [How-to: Run Goli-CLI in CI](../user/how-to/ci-headless-mode.md)
- [Migration Guides](migration-guides/)
- [Runbooks](runbooks/)
