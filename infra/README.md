# GOLI-CLI Deployment & Observability Infrastructure (Module 6)

This directory contains Docker Compose and Kubernetes manifests for
hosting the observability stack (Langfuse + Postgres + ClickHouse)
and the LiteLLM router that enforces open-weight-only model routing.

## Quick Start (Docker Compose)

```bash
cd infra
cp .env.example .env  # edit to set secrets (POSTGRES_PASSWORD, LITELLM_MASTER_KEY, ...)
docker compose up -d
```

> **Note:** The `.env.example` template is generated on first run if
> not present — see `infra/docker-compose.yml` for the required
> environment variables. If `.env.example` is not present in your
> checkout, copy the `environment:` block from the docker-compose file.

This starts:

- **Langfuse** (observability UI) on `http://localhost:3000`
- **Postgres** (Langfuse metadata) on `localhost:5432`
- **ClickHouse** (Langfuse trace storage) on `localhost:8123`
- **LiteLLM Router** on `http://localhost:4000` — open-weight-only routing
- **vLLM** (self-hosted open-weight inference — defaults to `gpt-oss:120b`; swap to `glm-5.2`, `deepseek-v3`, `qwen3-coder`, or `kimi-k2.7-code` per your needs) on `http://localhost:8000`

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

| Model            | Provider                           | Use Case                                                                                 |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `gpt-oss:120b`   | Ollama Cloud (or self-hosted vLLM) | Default agent model (matches the CLI's default `GOLI_DEFAULT_MODEL=ollama/gpt-oss:120b`) |
| `glm-5.2`        | `z.ai` (or self-hosted vLLM)       | Open-weight MoE alternative                                                              |
| `deepseek-v3`    | `deepseek`                         | Hard-task fallback                                                                       |
| `qwen3-coder`    | `together-ai`                      | Code-specialized fallback                                                                |
| `kimi-k2.7-code` | `moonshot`                         | Long-context fallback                                                                    |

Closed-weight models (GPT-4, Claude, Gemini) are NOT listed and are
blocked at the router level (`BLOCKED_PROVIDERS`). See
`docs/decisions/0034-open-weight-only-routing.md`.

## Self-Hosted vLLM (Data Sovereignty)

For GDPR / EU AI Act compliance, GOLI-CLI supports self-hosted
open-weight inference on owned GPU infra (8×H100/H200, FP8).
The vLLM container in `docker-compose.yml` is a stub — replace the
`model` arg with the HuggingFace path to your local weights
(e.g. `gpt-oss/gpt-oss:120b`, `zai-org/GLM-5.2`, `deepseek-ai/deepseek-v3`,
`Qwen/Qwen3-Coder`, `moonshotai/Kimi-K2.7-Code`).

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

Production (Kubernetes, self-hosted open-weight inference):

- 8× H100 80GB (vLLM inference)
- 64 GB RAM (Postgres + ClickHouse + Langfuse)
- 16 CPU cores
- 500 GB SSD (trace retention, 30-day default)
