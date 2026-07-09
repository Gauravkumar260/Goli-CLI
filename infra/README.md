# GOLI-CLI Deployment & Observability Infrastructure (Module 6)

This directory contains Docker Compose and Kubernetes manifests for
hosting the observability stack (Langfuse + Postgres + ClickHouse)
and the LiteLLM router that enforces open-weight-only model routing.

## Quick Start (Docker Compose)

```bash
cd infra
cp .env.example .env  # edit to set secrets
docker compose up -d
```

This starts:
- **Langfuse** (observability UI) on `http://localhost:3000`
- **Postgres** (Langfuse metadata) on `localhost:5432`
- **ClickHouse** (Langfuse trace storage) on `localhost:8123`
- **LiteLLM Router** on `http://localhost:4000` — open-weight-only routing
- **vLLM** (self-hosted GLM-5.2 inference) on `http://localhost:8000`

## Quick Start (Kubernetes)

```bash
cd infra/k8s
kubectl apply -f namespace.yaml
kubectl apply -f postgres.yaml
kubectl apply -f clickhouse.yaml
kubectl apply -f langfuse.yaml
kubectl apply -f litellm.yaml
kubectl apply -f vllm.yaml
```

Production deployments should use Helm charts (TODO) for easier
 upgrades and secret management.

## LiteLLM Router Configuration

`infra/litellm/config.yaml` defines the model routing. Only open-weight
models are listed:

| Model | Provider | Use Case |
|-------|----------|----------|
| `glm-5.2` | `z.ai` (or self-hosted vLLM) | Default agent model |
| `deepseek-v3` | `deepseek` | Hard-task fallback |
| `qwen3-coder` | `together-ai` | Code-specialized fallback |
| `kimi-k2.7-code` | `moonshot` | Long-context fallback |

Closed-weight models (GPT-4, Claude) are NOT listed and are blocked
at the router level. See `docs/decisions/0034-open-weight-only-routing.md`.

## Self-Hosted vLLM (Data Sovereignty)

For GDPR / EU AI Act compliance, GOLI-CLI supports self-hosted GLM-5.2
on owned GPU infra (8×H100/H200, FP8). The vLLM container in
`docker-compose.yml` is a stub — replace the `model` arg with the
path to your local GLM-5.2 weights.

See `docs/decisions/0001-sandbox-as-trust-boundary.md` and
`SECURITY.md` for the data-sovereignty threat model.

## Observability: Langfuse vs LangSmith

We chose Langfuse (self-hosted, MIT-licensed) over LangSmith
 proprietary SaaS). See `docs/decisions/0032-langfuse-over-langsmith.md`.

Reasons:
1. **Data sovereignty** — traces never leave your infra
2. **Cost** — Langfuse is free; LangSmith charges per-trace
3. **Open-source** — MIT-licensed, auditable, forkable
4. **OTLP-compatible** — works with the OTel tracer in `packages/core/src/observability/`

## Resource Requirements

Minimum (Docker Compose, development):
- 16 GB RAM
- 4 CPU cores
- 50 GB disk (for ClickHouse trace retention)

Production (Kubernetes, self-hosted GLM-5.2):
- 8× H100 80GB (vLLM inference)
- 64 GB RAM (Postgres + ClickHouse + Langfuse)
- 16 CPU cores
- 500 GB SSD (trace retention, 30-day default)
