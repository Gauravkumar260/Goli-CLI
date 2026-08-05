# How-to: Self-Host Goli-CLI with Kubernetes

> **Goal:** Run Goli-CLI in a self-hosted k8s cluster for a regulated
> industry (no cloud LLM calls; everything on-prem).

This guide walks through deploying Goli-CLI with vLLM (open-weight model
serving), LiteLLM (LLM gateway), Langfuse (trace visualization), and
ClickHouse + Postgres (backing stores). All manifests are in
`infra/k8s/`.

## Prerequisites

- A k8s cluster (1.28+) with `kubectl` configured.
- A GPU nodepool (for vLLM) — at least 1× A100 80GB or 4× A10G.
- The NVIDIA GPU Operator installed (for vLLM to see the GPUs).
- A load balancer (MetalLB, AWS NLB, GCP LB, etc.).

## Step 1: Create the namespace

```bash
kubectl apply -f infra/k8s/namespace.yaml
```

This creates the `goli` namespace.

## Step 2: Deploy Postgres (for Langfuse)

```bash
kubectl apply -f infra/k8s/postgres.yaml
```

This deploys a single-replica Postgres with a persistent volume. For
production, use a managed Postgres (RDS, Cloud SQL) instead.

## Step 3: Deploy ClickHouse (for Langfuse analytics)

```bash
kubectl apply -f infra/k8s/clickhouse.yaml
```

Langfuse uses ClickHouse to store traces and analytics. Single-replica
is fine for small teams; for >100 users, scale to a cluster.

## Step 4: Deploy Langfuse

```bash
# Create the secret with Langfuse's config
kubectl apply -f infra/k8s/secrets.yaml  # edit this first!

kubectl apply -f infra/k8s/langfuse.yaml
```

Langfuse will be available at `https://langfuse.your-domain.com` once
you set up the ingress.

## Step 5: Deploy vLLM

```bash
kubectl apply -f infra/k8s/vllm.yaml
```

This deploys vLLM serving `ollama/gpt-oss:120b` on the GPU nodepool.
The pod takes ~10 minutes to start (model download + GPU init).

Verify:

```bash
kubectl -n goli port-forward svc/vllm 8000:8000
curl http://localhost:8000/v1/models
# {"data":[{"id":"gpt-oss:120b",...}]}
```

## Step 6: Deploy LiteLLM

Edit `infra/litellm/config.yaml` to point at your vLLM service:

```yaml
model_list:
  - model_name: ollama/gpt-oss:120b
    litellm_params:
      model: openai/gpt-oss:120b
      api_base: http://vllm.goli.svc.cluster.local:8000/v1
      api_key: dummy
```

Deploy:

```bash
kubectl apply -f infra/k8s/litellm.yaml
```

LiteLLM is now the LLM gateway. Goli-CLI will route through it instead
of calling providers directly.

## Step 7: Configure Goli-CLI to use the self-hosted stack

Set these env vars on the developer's machine (or in CI):

```bash
export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b"
export OPENAI_BASE_URL="https://litellm.your-domain.com/v1"
export OPENAI_API_KEY="<litellm-master-key>"

# Traces go to Langfuse
export GOLI_LANGFUSE_BASE_URL="https://langfuse.your-domain.com"
export GOLI_LANGFUSE_PUBLIC_KEY="pk-lf-..."
export GOLI_LANGFUSE_SECRET_KEY="sk-lf-..."
```

Verify:

```bash
goli -p "hello" --debug
# Logs should show requests going to litellm.your-domain.com
```

## Step 8: Check the traces in Langfuse

Open `https://langfuse.your-domain.com`, log in, and navigate to
"Traces". You should see your `goli` run with its full trajectory
(prompt, tool calls, responses, latency).

## Production hardening

For production, also:

- **Use managed Postgres** (RDS / Cloud SQL) instead of the in-cluster
  Postgres.
- **Scale ClickHouse to a cluster** for >100 users.
- **Add HPA to vLLM** based on GPU utilization.
- **Add backup** for Postgres and ClickHouse (Velero or managed
  backups).
- **Add monitoring** (Prometheus + Grafana) — see `infra/k8s/` (planned).
- **Add auth** to Langfuse (it's open by default in the manifest —
  configure NextAuth before going live).

## See also

- [`infra/README.md`](../../../infra/README.md) — the infra README.
- [`infra/docker-compose.yml`](../../../infra/docker-compose.yml) —
  single-host Docker Compose for dev.
- [ADR 0028](../../decisions/0028-colocate-vllm-mode.md) — colocate
  vLLM mode.
- [ADR 0032](../../decisions/0032-langfuse-over-langsmith.md) — Langfuse
  over Langsmith.
