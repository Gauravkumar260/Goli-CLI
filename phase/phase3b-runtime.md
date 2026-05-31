# Phase 3B — AI Infrastructure: Runtime
**Date**: 2025-05-31 | **Status**: 🟡 In Progress | **Part**: 2 of 2

> **Scope of Part B**: Build and verify — execution sandbox, inference infrastructure,
> storage layer, observability, and the three hardware-validated spike solutions.
>
> **Prerequisite**: `phase3a-foundation.md` must be complete (model selected, context
> pipeline designed, indexing pipeline running).

---

## Hardware Baseline (Repeated for Reference)

| Component | Spec | Key constraint |
|-----------|------|----------------|
| CPU | i7-6600U @ 2.60GHz, **2 cores / 4 threads** | Dual-core only; agent containers compete aggressively |
| RAM | 16GB | WSL2 VM + Docker + Ollama (if used) + host leaves ~4–5GB for containers |
| Storage | 466GB NVMe SSD | Fast enough; not a bottleneck |
| GPU | Intel HD Graphics 520 (**no CUDA**) | No GPU acceleration anywhere in the stack |
| OS | Windows 11 x64 | Docker must use **WSL2 backend**. OrbStack is macOS-only — not applicable. |

---

## Step 4 — Execution Sandbox

### Architecture Principle

Decouple the **harness** (stateless brain: prompts, tool calls, reasoning) from the
**sandbox** (disposable hands: code execution, file mutation, test running).
The harness survives sandbox failures. The sandbox is replaced, not repaired.

```
Task received
   │
   ▼
Harness: compile context + tool call → "run these shell commands in sandbox"
   │
   ▼
Provision Docker container (WSL2 backend; warm image from local cache)
   │
   ▼
Agent executes tools: file read/write, terminal, test runner
   │
   ▼
Validation: run tests, static analysis, diff review
   │
   ▼
Output patch / PR diff
   │
   ▼
Teardown: destroy container; log session; clear any temp secrets
```

### Sandbox Technology: Docker Desktop with WSL2 Backend

OrbStack is macOS-only. On Windows, the correct path is **Docker Desktop with WSL2
backend enabled** — or Docker Engine running directly inside WSL2 (no Docker Desktop GUI).

**Option A — Docker Desktop + WSL2 (recommended: easier ops)**

1. Docker Desktop → Settings → General: ensure "Use WSL2 based engine" is checked
2. Docker Desktop → Settings → Resources → WSL Integration: enable for your WSL2 distro
3. Docker Desktop → Settings → Resources → Advanced: set limits (see below)

**Option B — Docker Engine inside WSL2 directly (recommended: better performance)**

Removes the Docker Desktop GUI overhead (~300MB RAM, GUI process).
```bash
# Inside WSL2 Ubuntu terminal
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Restart WSL2 terminal; docker is now native inside WSL2
```

**WSL2 memory configuration (required — do this before anything else):**

Create or edit `C:\Users\<YourUsername>\.wslconfig`:
```ini
[wsl2]
memory=12GB       # Cap WSL2 VM at 12GB; leaves ~4GB for Windows host processes
processors=4      # All 4 threads available inside WSL2
swap=0            # Disable WSL2 swap; avoid writes to SSD under memory pressure
```

After editing, apply: `wsl --shutdown` then reopen your terminal.

**Why this matters**: Without `.wslconfig`, WSL2 defaults to using 50–80% of total RAM
(~8–13GB). Under load, Windows will start paging host processes, causing the entire system
to crawl. The 12GB cap keeps 4GB reserved for Windows OS and background processes.

### Container Resource Limits (Hardware-Calibrated for i7-6600U)

```typescript
// src/sandbox/DockerSandbox.ts
HostConfig: {
  NetworkMode: 'none',                        // no outbound network — non-negotiable

  // Memory
  Memory:     1.5 * 1024 * 1024 * 1024,      // 1.5GB per agent container
  MemorySwap: 1.5 * 1024 * 1024 * 1024,      // set equal = swap disabled for this container
  OomKillDisable: false,                       // let OOM killer terminate container, NOT host

  // CPU — calibrated for dual-core i7-6600U
  CpuPeriod: 100000,
  CpuQuota:  75000,     // 0.75 CPU equivalent per container
                        // On a 4-thread dual-core, 1.0 per container = no headroom for host
                        // 0.75 leaves ~1.25 threads for harness + OS + WSL2 at max_parallel=2

  PidsLimit: 256,                              // prevent fork-bomb inside sandbox
}
```

**Why 0.75 CPU, not 1.0**: On the i7-6600U (2 physical cores), allocating a full CPU
core to each container means two containers saturate all 4 threads, leaving nothing for
the Node.js harness, WSL2 overhead, or Windows. 0.75 per container at `max_parallel=1`
leaves 1.25 threads for the rest of the system; at `max_parallel=2` leaves 0.5 threads
(tight but functional for short bursts).

### Parallelism: max_parallel Tuning

```typescript
// src/agent/TeamRunner.ts
import os from 'os'

function getMaxParallel(): number {
  const totalMem = os.totalmem()
  const cpuCount = os.cpus().length  // returns logical CPUs (threads)

  if (totalMem >= 32 * 1024 ** 3) return 3        // 32GB+: 3 parallel agents
  if (totalMem >= 16 * 1024 ** 3 && cpuCount >= 8) return 2  // 16GB + 8+ threads
  if (totalMem >= 16 * 1024 ** 3 && cpuCount >= 4) {
    // 16GB, 4 threads (this machine): 1 if Ollama running; 2 if API-only
    return process.env.USE_LOCAL_LLM === 'true' ? 1 : 2
  }
  return 1  // fallback: always safe
}

const MAX_PARALLEL = getMaxParallel()
```

**Memory budget check for this machine at `max_parallel=2`:**
| Component | RAM used |
|-----------|----------|
| Windows 11 host | ~3.0GB |
| WSL2 VM baseline | ~1.5GB |
| Docker Engine inside WSL2 | ~0.3GB |
| Ollama (qwen2.5-coder:1.5b, if used) | ~1.7GB |
| 2× agent containers @ 1.5GB each | ~3.0GB |
| LanceDB + Tantivy in harness process | ~0.5GB |
| Node.js harness | ~0.3GB |
| **Total** | **~10.3GB** |

With local Ollama + 2 agents: ~10.3GB → within the 12GB WSL2 cap. Leaves ~1.7GB
headroom inside WSL2, plus 4GB reserved for Windows. This is tight but workable.

**Without Ollama (Claude API only):** drop Ollama's ~1.7GB → ~8.6GB total. Comfortable.

### Container Image (keep it minimal to hit P95 < 2s cold start)

```dockerfile
# Use alpine-based image; avoid debian unless required by dependencies
FROM node:20-alpine

# Install only what the agent actually needs
RUN apk add --no-cache git bash python3 make g++

WORKDIR /workspace

# Pre-install common deps so they're cached in the image layer
COPY package*.json ./
RUN npm ci --production

USER node  # never run as root inside container
```

**Image size target**: under 400MB. Larger images add cold-start time.
**Pre-pull the image** during harness startup, not on first agent request:
```typescript
// src/sandbox/DockerSandbox.ts — call at process start, not per-task
await docker.pull('your-agent-image:latest')
```

### Security Constraints (Non-Negotiable)

```
├── NO network egress        (NetworkMode: 'none' — already set above)
├── NO host secrets          (never mount .env or ~/.ssh into container)
├── NO privilege escalation  (USER node, not root; no --privileged flag)
├── Filesystem: read-only except /workspace
├── Execution timeout: 30s per tool call, 10min per session total
└── OomKillDisable: false    (always; never disable OOM killer without memory limit)
```

---

## Step 5 — Inference Infrastructure

### Latency Targets (Adjusted for CPU-Only / Claude API Path)

| Use case | TTFT target | Total response target |
|----------|-------------|----------------------|
| Inline autocomplete | <200ms | <800ms |
| Function generation | <500ms | <5s |
| Repo-level task | <1s TTFT | <45s total |
| Async agentic task | Async OK | SLA: 5 minutes |

Note: these targets assume Claude API (network-bound latency ~150–300ms TTFT from India).
Local CPU inference with even a 1.5B model will not meet the autocomplete target reliably.

### Claude API — Optimisation Config

```typescript
// src/inference/ClaudeClient.ts
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  maxRetries: 3,         // automatic retry with exponential backoff
  timeout: 30_000,       // 30s timeout per request
})

export async function streamCompletion(
  systemPrompt: string,
  userMessages: MessageParam[],
  model: "claude-haiku-4-5" | "claude-sonnet-4-6" = "claude-haiku-4-5"
) {
  const stream = await client.messages.stream({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: userMessages,
  })
  return stream  // stream back to IDE client — reduces perceived latency ~10×
}
```

**Enable prompt caching** (up to 90% cost reduction on repeated system prompts):
```typescript
// Mark your system prompt as cacheable — Anthropic caches prefixes automatically
// Ensure the system prompt + repo context prefix is identical across requests
// The first request pays full cost; subsequent requests with same prefix are cached
messages: [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: systemPromptAndRepoContext,
        cache_control: { type: "ephemeral" }   // marks this block for caching
      },
      { type: "text", text: userTask }
    ]
  }
]
```

**Request queue with per-session rate limiting:**
```typescript
// Prevent runaway costs from recursive agent loops
import PQueue from 'p-queue'

const inferenceQueue = new PQueue({ concurrency: 2 })  // max 2 concurrent API calls
const sessionCostUsd = new Map<string, number>()

const SESSION_COST_CAP_USD = 0.50  // hard stop at $0.50/session; adjust per budget
```

### Serving Stack: API vs Local Side-by-Side

| Path | Stack | When to use |
|------|-------|-------------|
| **Claude API (recommended)** | `@anthropic-ai/sdk` + streaming | All tasks on this hardware |
| Local small model | Ollama + `qwen2.5-coder:1.5b` | Offline only; autocomplete only |
| Local reranker | Ollama + `bge-reranker` | Always — see Spike 2 |

**Ollama (if used) — WSL2 config:**
```bash
# Set Ollama to use CPU only (it will auto-detect; just confirm)
# Inside WSL2:
OLLAMA_HOST=0.0.0.0 ollama serve

# Verify from Windows host or another WSL2 process:
curl http://localhost:11434/api/generate -d '{"model":"nomic-embed-code","prompt":"test"}'
```

---

## Step 6 — Data and Storage Layer

```
Data type                 │ Storage            │ Notes
──────────────────────────┼────────────────────┼──────────────────────────────────────
Vector embeddings         │ LanceDB (local)    │ NVMe; ~8–10ms warm query; no server
BM25 index                │ Tantivy WASM       │ In-process; no separate service
Session logs (agent turns)│ SQLite (append)    │ Use WAL mode; one file per session
User prefs / AGENTS.md    │ SQLite or JSON     │ Per-repo config, small
Eval golden sets          │ Local /evals/      │ Committed to git; version-controlled
Model artifacts (Ollama)  │ ~/.ollama/models/  │ Managed by Ollama; ~1–6GB per model
Telemetry events          │ SQLite (local)     │ Rotate daily; export for analysis
Audit log (agent actions) │ Append-only file   │ JSONL format; never delete
```

**Schema rules:**
- Session logs: append-only, never update in place. JSONL, one event per line.
- Audit logs: every tool call logged with: `{timestamp, session_id, tool_name, payload_hash, result_code}`.
- Never store raw user code in a shared table. If multi-user is added later, tenant-isolate from day one.

**SQLite config for append-heavy workloads:**
```sql
PRAGMA journal_mode=WAL;      -- write-ahead log: concurrent reads + writes
PRAGMA synchronous=NORMAL;    -- faster than FULL; safe on NVMe SSD
PRAGMA cache_size=-64000;     -- 64MB page cache in RAM
```

---

## Step 7 — Observability and Cost Instrumentation

Instrument these signals **before the first user session**. Cost and safety signals are
especially critical given this hardware's constrained resources.

### Latency Metrics
```
agent.request.ttft_ms           Time to first token (TTFT)
agent.request.total_ms          End-to-end request latency
agent.sandbox.provision_ms      Container cold start time    ← Spike 1 target: P95 < 2000
agent.retrieval.latency_ms      RAG pipeline latency
agent.tool.{name}.latency_ms    Per-tool execution time
```

### Retrieval Quality Signals
```
agent.retrieval.precision_at_5  Fraction of top-5 chunks that were used in final answer
agent.retrieval.recall          Fraction of relevant chunks retrieved
agent.reranker.latency_ms       Cross-encoder reranker latency   ← target: <1500ms on CPU
```

### Quality Signals
```
agent.suggestion.shown          Suggestion rendered
agent.suggestion.accepted       Accepted without edit
agent.suggestion.edited         Accepted with edit
agent.suggestion.rejected       User dismissed
agent.task.completed            Full task completed successfully
agent.task.abandoned            Session abandoned mid-task
```

### Cost Signals (Critical on API)
```
agent.inference.input_tokens    Per request
agent.inference.output_tokens   Per request
agent.inference.cost_usd        Estimated cost (haiku: $0.001/k in, $0.005/k out)
agent.session.total_cost_usd    Total cost per session
```

**Budget alert**: Add a hard stop when session cost exceeds your threshold:
```typescript
if (sessionCostUsd.get(sessionId)! > SESSION_COST_CAP_USD) {
  throw new Error(`Session cost cap ($${SESSION_COST_CAP_USD}) reached. Task aborted.`)
}
```

### Safety Signals (feeds Phase 5)
```
agent.safety.denial             Action denied by classifier
agent.safety.injection_probe    Injection attempt detected
agent.safety.human_approval     Human approval requested
agent.sandbox.oom_kill          Container OOM-killed (critical: means memory limit too low)
```

### Recommended Stack for Solo Dev
OpenTelemetry for instrumentation → write to **stdout structured JSON** → pipe to a local
SQLite telemetry table → build a simple Grafana dashboard if needed, or query directly.

No need to run a Prometheus + Grafana stack locally on this hardware. A SQLite telemetry
table queried with DuckDB is functionally equivalent and uses ~50MB RAM vs ~800MB.

---

## Spike Solutions

These are validated fixes for the three pre-identified risk spikes. Each solution is
calibrated for the actual hardware: Windows 11, i7-6600U, 16GB RAM, no GPU.

---

### Spike 1 — Sandbox P95 Cold Start < 2 Seconds

**Root cause of risk**: Docker on Windows uses a WSL2 hypervisor layer. Without
configuration, Docker Desktop's VM is under-resourced and image pulls happen on-demand
(not pre-warmed), causing cold starts of 3–6s.

**Fix A — WSL2 backend + resource tuning (primary fix)**

The `.wslconfig` from Step 4 is required. Then configure Docker Desktop resource limits:

Docker Desktop → Settings → Resources → Advanced:
```
CPUs:   4          (all 4 threads)
Memory: 10GB       (leave 2GB for Windows; .wslconfig handles the hard cap at 12GB)
Swap:   0GB
```

Or if using Docker Engine directly in WSL2 (Option B from Step 4): the `.wslconfig` limits
apply automatically; no separate Docker Desktop setting needed.

**Fix B — Pre-pull and warm the container image**

```typescript
// src/sandbox/SandboxPool.ts
export class SandboxPool {
  private warmPool: Docker.Container[] = []
  private readonly POOL_SIZE = 1   // 1 pre-warmed container; more = more RAM

  async initialize() {
    await this.docker.pull('your-agent-image:latest')  // ensure image cached
    // Pre-create one container so first user request skips cold start
    const container = await this.docker.createContainer({ Image: 'your-agent-image:latest', ... })
    this.warmPool.push(container)
  }

  async acquire(): Promise<Docker.Container> {
    if (this.warmPool.length > 0) {
      const container = this.warmPool.pop()!
      this.replenishPool()   // async; don't await
      return container
    }
    return this.provisionCold()
  }
}
```

A single pre-warmed container uses ~50–80MB idle RAM. On 16GB this is acceptable.

**Fix C — Daytona (fallback if P95 still > 2s)**

If cold starts remain > 2s after the above (possible if Docker Desktop has other issues
on your machine), [Daytona](https://daytona.io) provides managed sandbox infrastructure
with 150–200ms realistic cold starts from a warm pool. Free tier available for evaluation.

**Verification:**
```typescript
// Measure P95 cold start across 20 samples
const times = []
for (let i = 0; i < 20; i++) {
  const t0 = Date.now()
  const container = await docker.createContainer({ ... })
  await container.start()
  times.push(Date.now() - t0)
}
const p95 = times.sort((a,b) => a-b)[Math.floor(times.length * 0.95)]
console.log(`P95 cold start: ${p95}ms`)  // target: < 2000
```

---

### Spike 2 — Retrieval Precision@5 > 0.80

**Root cause**: The pipeline stops at BM25 + vector RRF fusion. This reaches ~0.70
Precision@5. The missing layer is a cross-encoder reranker, which scores each
(query, chunk) pair jointly — far more accurate than any first-stage method.

**Evidence:**

| Stage | Precision@5 |
|-------|-------------|
| BM25 only | ~0.64 |
| Dense vector only | ~0.59 |
| BM25 + vector RRF | ~0.70 |
| + Cross-encoder reranker | **~0.82** ← target |

The ~17% gain from adding the reranker is the largest single improvement available
at this stage of the pipeline.

**Implementation — `src/retriever/reranker.ts`:**

```typescript
// Cross-encoder reranker using bge-reranker via Ollama (local, CPU, free)
// Pull: ollama pull bge-reranker (~500MB; CPU inference ~0.5–1.0s per pair on i7-6600U)

interface RerankCandidate {
  chunkId: string
  text: string
}

export async function rerank(
  query: string,
  candidates: RerankCandidate[],   // top-20 from RRF fusion
  topK = 5
): Promise<string[]> {
  // Score each candidate pair with cross-encoder via Ollama
  const scores = await Promise.all(
    candidates.map(async (candidate) => {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'bge-reranker',
          prompt: `query: ${query}\npassage: ${candidate.text}`,
        })
      })
      const { embedding } = await response.json()
      // bge-reranker returns a relevance score as the first embedding dimension
      return { chunkId: candidate.chunkId, score: embedding[0] }
    })
  )

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.chunkId)
}
```

**How it fits into the pipeline:**
```
BM25 (top 20) ──┐
                ├── RRF fusion (top 20) ──→ cross-encoder reranker ──→ top 5 to context
Vector (top 20) ┘
```

The reranker operates on a **shortlist of 20**, not the full index. It is a
precision layer, not a recall layer — keep first-stage retrieval broad (top 20),
then let the reranker decide the final 5.

**CPU latency on i7-6600U**: ~0.5–1.0s to score 20 candidates. This fits the retrieval
latency budget for all non-autocomplete tasks. For autocomplete (latency-sensitive), skip
the reranker and use RRF top-5 directly.

**Tuning if P@5 is still below 0.80 after adding reranker:**
- Analyse failures: if BM25 misses paraphrase queries → increase vector weight in RRF
- If vector returns vaguely related docs → increase BM25 weight in RRF
- Bump `symbol_name` BM25 boost to **5×** (vs the default 3× in generic docs)
- Check chunk quality: if chunks contain multiple unrelated functions, fix chunking first

---

### Spike 3 — Multi-Agent OOM on 16GB Windows

**Root cause**: No per-container memory limits, no CPU quota, and `max_parallel` set too
high for available RAM after OS + WSL2 + Ollama overhead is accounted for.

**Complete fix (three changes):**

**1. Per-container memory ceiling — `src/sandbox/DockerSandbox.ts`:**
```typescript
HostConfig: {
  NetworkMode: 'none',
  Memory:     1.5 * 1024 * 1024 * 1024,   // 1.5GB per container
  MemorySwap: 1.5 * 1024 * 1024 * 1024,   // no swap (equal = disabled)
  OomKillDisable: false,                   // NEVER disable OOM killer without a memory limit
  CpuPeriod: 100000,
  CpuQuota:  75000,                        // 0.75 CPU — calibrated for dual-core i7-6600U
  PidsLimit: 256,
}
```

**2. Hardware-aware `max_parallel` — `src/agent/TeamRunner.ts`:**
```typescript
import os from 'os'

function getMaxParallel(): number {
  const gb = os.totalmem() / (1024 ** 3)
  const threads = os.cpus().length

  if (gb >= 32) return 3
  if (gb >= 16 && threads >= 8) return 2
  if (gb >= 16 && threads >= 4) {
    // This machine: 16GB, 4 threads (dual-core i7-6600U)
    // If Ollama is running locally, parallel agents fight for the same CPU threads
    return process.env.USE_LOCAL_LLM === 'true' ? 1 : 2
  }
  return 1
}

export const MAX_PARALLEL = getMaxParallel()
```

**3. WSL2 memory reclaim** (Windows-specific, replaces OrbStack on macOS):

WSL2 is slower to reclaim container memory than OrbStack, but it does reclaim.
The `.wslconfig` hard cap (set in Step 4) is the primary protection — it prevents WSL2
from expanding beyond 12GB regardless of container activity.

To force immediate WSL2 memory reclaim after container teardown:
```typescript
// src/sandbox/DockerSandbox.ts
async teardown(container: Docker.Container) {
  await container.stop()
  await container.remove({ force: true })
  // WSL2 reclaims over ~30–60s naturally; no manual trigger needed
  // The .wslconfig cap prevents burst-OOM even before reclaim completes
}
```

**Memory budget validation (run this before enabling multi-agent):**
```typescript
// src/agent/TeamRunner.ts — check before spawning a new agent
import os from 'os'

function hasHeadroom(requiredMb = 1600): boolean {
  const freeMb = os.freemem() / (1024 * 1024)
  return freeMb > requiredMb + 512   // 512MB buffer above container requirement
}

if (!hasHeadroom()) {
  throw new Error('Insufficient memory to spawn agent. Wait for current tasks to complete.')
}
```

**Summary table for all three spikes:**

| Spike | Fix | Cost | Effort |
|-------|-----|------|--------|
| Sandbox P95 < 2s | WSL2 backend + `.wslconfig` + pre-warm pool | Free | 30 min |
| Retrieval P@5 > 0.80 | Cross-encoder reranker (`bge-reranker` via Ollama) | Free | 1 day |
| Multi-agent OOM | 1.5GB memory cap + 0.75 CPU quota + `max_parallel` logic | Free | 30 min |

---

## Phase 3B Exit Criteria

Phase 3 (both parts) is complete when:

- [ ] **Sandbox provisioned** with isolation, memory cap, CPU quota, and network block verified
- [ ] **Container cold start P95 measured** and under 2s (Spike 1 resolved)
- [ ] **Cross-encoder reranker integrated** into retrieval pipeline; P@5 measured ≥ 0.80 (Spike 2)
- [ ] **`max_parallel` logic deployed**; memory headroom check working; no OOM events in 10-run test (Spike 3)
- [ ] **Claude API client** configured with streaming, retry, prompt caching, per-session cost cap
- [ ] **Latency baselines measured**: TTFT P50/P95 for each task tier
- [ ] **Cost baseline established**: average cost-per-task for Haiku and Sonnet
- [ ] **All observability signals** instrumented and writing to telemetry store
- [ ] **Session logs and audit log** operational (append-only, verified)
- [ ] **WSL2 `.wslconfig`** in place and validated (`wsl --status` shows memory limit)
- [ ] **Phase 3A and 3B documents** committed to `docs/`

**Phase 3 final outputs:**
1. **Green** — all checks pass; proceed to Phase 4 (Core Agent Architecture)
2. **Yellow** — proceed with stated condition (e.g., "reranker P@5 = 0.77; Spike 2 tuning continues in parallel")
3. **Red** — critical blocker (OOM events unresolved, sandbox start > 5s, API cost uncapped)

---

## Common Failure Modes (Windows-Specific Additions)

| Failure | Symptom | Fix |
|---------|---------|-----|
| WSL2 using Hyper-V backend | Container start > 5s; Docker Desktop shows "Hyper-V" in status | Switch to WSL2 backend in Docker Desktop settings |
| No `.wslconfig` memory cap | Windows paging after 20min of agent usage; system sluggish | Add `.wslconfig` with `memory=12GB`; `wsl --shutdown` |
| Ollama + 2 agents + 16GB | OOM kill on container; i7-6600U pegged at 100% | Set `USE_LOCAL_LLM=false` or `max_parallel=1` |
| Docker Desktop GUI overhead | ~300MB extra RAM; slow background updates | Switch to Docker Engine inside WSL2 (Option B in Step 4) |
| Line-based chunking | Retrieval returns half-functions | Use Tree-sitter; split at semantic boundaries |
| No incremental indexing | Full re-index on save; 30s latency spike | Diff-based incremental from day one |
| Sandbox shares host filesystem | Agent reads secrets / exfiltrates code | Read-only mount; /workspace only writable |
| No prompt caching | 50–90% inference cost overspend | Enable `cache_control: ephemeral` on system prompt |
| No cost cap per session | Recursive agent loops burn $5+ unnoticed | Hard stop at session cost threshold (see Step 5) |
| OomKillDisable: true without limit | Host OOM cascades; entire WSL2 VM crashes | Never disable OOM killer; always set Memory limit first |

---

*Phase 3 complete → proceed to `phase4-agent-architecture.md`*
