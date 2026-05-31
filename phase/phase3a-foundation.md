# Phase 3A — AI Infrastructure: Foundation
**Date**: 2025-05-31 | **Status**: 🟡 In Progress | **Part**: 1 of 2

> **Scope of Part A**: Planning and design decisions — model selection, context strategy,
> and the chunking + indexing pipeline. No containers, no inference servers.
> These decisions constrain everything in Phase 3B.
>
> **Part B** (`phase3b-runtime.md`) covers: Execution Sandbox, Inference Infrastructure,
> Data & Storage, Observability, and all three Spike Solutions.

---

## Hardware Reality Check

Before any decision, calibrate against the actual machine. This spec is the constraint floor
for every choice in this document.

| Component | Spec | Implication |
|-----------|------|-------------|
| CPU | Intel i7-6600U @ 2.60GHz (2 cores / 4 threads, Skylake 2015) | **Dual-core only.** CPU-bound inference is very slow. Parallel agents compete hard for cores. |
| RAM | 16GB (15.6GB usable) | Tight with WSL2 + Docker + Ollama running simultaneously. Every GB must be budgeted. |
| Storage | 466GB NVMe SSD (WD Green SN350) | Fast enough for vector index queries (~8–10ms). No spinning disk penalty. |
| GPU | Intel HD Graphics 520 (128MB shared) | **No CUDA. No GPU acceleration.** All inference is CPU-only. No Ollama GPU offloading. |
| OS | Windows 11, x64 | Docker must use WSL2 backend. OrbStack is macOS-only — not available here. |

**Bottom-line hardware constraints that override the generic skill guidance:**

1. **No GPU → local LLMs are impractical for anything >3B parameters** at interactive speed
   on this CPU. A 7B Q4 model produces ~2–5 tokens/second on i7-6600U. That is unusable
   for a coding agent. Use the Claude API for all generation tasks.

2. **Dual-core → `max_parallel` agent sandboxes must be 1, not 2**, unless Claude API is
   used for inference (no Ollama running). Details in Phase 3B Spike 3.

3. **16GB RAM with Windows overhead → WSL2 memory must be capped** via `.wslconfig`
   or Docker Desktop will eventually page Windows out of usable memory.

---

## Step 1 — Model Selection

### Recommended Path for This Hardware: Claude API (Closed API)

Running a local LLM on an i7-6600U with no GPU is not a viable path for a coding agent.
Use the Claude API. This eliminates Ollama, eliminates GPU requirements, and keeps your
16GB for the sandbox and vector index — where it matters.

**Recommended model tier assignment:**

| Task type | Model | Why |
|-----------|-------|-----|
| Repo-wide planning, complex refactor | `claude-sonnet-4-6` | Best quality-to-cost ratio at this tier |
| Function generation, test writing | `claude-haiku-4-5` | 3–5× cheaper than Sonnet; adequate for standard generation |
| Inline autocomplete (token-by-token) | `claude-haiku-4-5` | Lowest latency closed-API option |

**Rule**: Start with `claude-haiku-4-5` for 80% of requests (cheaper, fast). Escalate to
Sonnet only when Haiku fails your internal benchmark tasks. Never use Opus for routine
coding tasks — cost-per-session becomes unworkable quickly.

### If Local Inference is Required

If data residency or cost constraints prohibit the API, these are the only models worth
running on CPU-only hardware:

| Model | RAM needed | Speed on i7-6600U (Q4_K_M) | Verdict |
|-------|------------|----------------------------|---------| 
| `Qwen2.5-Coder-1.5B` | ~1.5GB | ~20–30 tok/s | Usable for autocomplete only |
| `Phi-3-mini-4k` | ~2.3GB | ~15–20 tok/s | Reasonable for short tasks |
| `DeepSeek-Coder-1.3B` | ~1.1GB | ~25–35 tok/s | Fast; weaker reasoning |
| `Qwen2.5-Coder-7B` | ~5.5GB | ~3–5 tok/s | Too slow for interactive use |
| Any 13B+ model | — | <2 tok/s | Non-viable on this hardware |

**How to run local models via Ollama on Windows (WSL2):**
```bash
# Inside WSL2 Ubuntu terminal
ollama pull qwen2.5-coder:1.5b
ollama serve  # starts HTTP server at localhost:11434
```

The **reranker model** (`bge-reranker-base`, ~277M parameters) is the exception. It is
small, runs comfortably at ~0.5–1.0s per (query, chunk) pair on CPU, and is required for
Spike 2. Pull it separately:
```bash
ollama pull bge-reranker  # ~500MB; CPU-only is fine for reranking
```

### Benchmarks to Run Before Committing

Always validate against your actual codebase before finalizing model choice:

| Benchmark | What it measures | Where to run it |
|-----------|-----------------|-----------------|
| **SWE-bench Verified** | End-to-end real GitHub issue resolution | Published leaderboard — compare externally |
| **HumanEval** | Function-level code generation | `openai/human-eval` GitHub repo |
| **Internal golden set** | 20–30 representative tasks from your own repo | Build this yourself — mandatory |

Build the internal benchmark first. SWE-bench scores are measured on open-source Python
repositories. Your codebase's language, idioms, and complexity may differ significantly.

---

## Step 2 — Context Strategy

### Recommended: Hybrid (Repo Map + BM25 + Dense Retrieval + Cross-Encoder Rerank)

This is the production-proven strategy. Every serious coding agent (Cursor, Claude Code,
Aider) converges on this pattern.

**Full pipeline:**

```
User task
   │
   ▼
1. Repo map (Tree-sitter AST → file/class/function inventory, ~5–10KB summary)
   │
   ▼
2. Query expansion (rewrite task as a retrieval query: "what symbols are involved?")
   │
   ▼
3a. BM25 retrieval — exact symbol match, function names, error strings (top 20)
3b. Dense vector retrieval — semantic similarity on function-level embeddings (top 20)
   │ (run in parallel)
   ▼
4. RRF fusion (Reciprocal Rank Fusion — merge BM25 + vector rankings into top 20)
   │
   ▼
5. Cross-encoder reranker (re-score each of the 20 candidates → return top 5)
   │      ← This is the Spike 2 fix. See Phase 3B for implementation.
   ▼
6. Priority-based prompt compilation
   (system prompt > task > repo map > retrieved chunks — drop lowest-priority at window limit)
   │
   ▼
7. Claude API call
```

**Context priority order (highest → lowest):**
1. System prompt (agent instructions, safety constraints)
2. Current task + user message
3. Recently opened/modified files (high recency signal)
4. Cross-encoder reranked chunks (top 5)
5. Repo map summary
6. Conversation history (summarised, not raw, for sessions >10 turns)

**Rule**: Never truncate from the top. Always drop lowest-priority context first.

### Why This Beats Simpler Alternatives

| Strategy | Precision@5 | Notes |
|----------|-------------|-------|
| BM25 only | ~0.64 | Misses paraphrased queries; strong for exact symbol names |
| Dense vector only | ~0.59 | Misses exact matches; slow to update index |
| BM25 + vector RRF | ~0.70 | Good baseline; what most agents ship first |
| BM25 + vector RRF + cross-encoder rerank | **~0.82** | Spike 2 target; see Phase 3B |

The cross-encoder reranker is the difference between ~0.70 and ~0.82 Precision@5.
It is non-negotiable for production retrieval quality.

### Context window sizing for Claude API

| Model | Context window | Practical advice |
|-------|---------------|-----------------|
| `claude-haiku-4-5` | 200k tokens | Use ≤32k for speed and cost; never fill the window |
| `claude-sonnet-4-6` | 200k tokens | Use ≤64k for complex repo tasks |

At ~4 characters per token, 32k tokens ≈ 128KB of code. That comfortably fits:
a repo map (5–8KB) + 5 retrieved chunks (avg 2KB each = 10KB) + system prompt (2KB) +
task description (1–2KB). Stay well under the limit for cost control.

---

## Step 3 — Chunking & Indexing Pipeline

### Chunking: Tree-sitter at Semantic Boundaries

Never split on line count or token count alone. Split at function/class/method boundaries.
Half-functions in context confuse the model and degrade generation quality.

**Install:**
```bash
pip install tree-sitter tree-sitter-languages
```

**Supported boundary types by language:**
```python
BOUNDARIES = {
    "python":     ["function_definition", "class_definition", "decorated_definition"],
    "typescript": ["function_declaration", "class_declaration",
                   "method_definition", "arrow_function"],
    "javascript": ["function_declaration", "class_declaration",
                   "function_expression", "arrow_function"],
    "rust":       ["function_item", "impl_item", "struct_item"],
    "go":         ["function_declaration", "method_declaration", "type_declaration"],
    "java":       ["method_declaration", "class_declaration"],
    "csharp":     ["method_declaration", "class_declaration", "property_declaration"],
}
```

**Chunk metadata to store alongside every embedding:**
```python
chunk_metadata = {
    "chunk_id":      str,   # hash(file_path + start_line) — stable across re-indexing
    "file_path":     str,   # relative from repo root: "src/auth/login.ts"
    "language":      str,   # "typescript"
    "node_type":     str,   # "function_declaration"
    "symbol_name":   str,   # fully qualified: "AuthService.validateToken"
    "start_line":    int,
    "end_line":      int,
    "imports":       list,  # imports visible to this chunk — critical for code context
    "docstring":     str,   # extracted if present
    "last_modified": str,   # git blame timestamp — recency scoring signal
}
```

**Size guardrails:**
- **Min chunk size**: 5 lines. Discard getters/trivial one-liners — they add noise.
- **Max chunk size**: 150 lines. If a function exceeds this, split into logical sub-blocks
  (each preceded by a comment summarising what comes before).
- **Overlap**: 2–3 lines of overlap between adjacent chunks from the same file
  for continuity.

### Embedding Model Selection (CPU-Optimised for Your Hardware)

| Model | Dimensions | Size | CPU inference speed | Notes |
|-------|------------|------|--------------------|----|
| `nomic-embed-code` | 768 | ~274MB | ~50–100 chunks/s on i7-6600U | **Recommended.** Open weights, runs via Ollama locally |
| `voyage-code-3` (Voyage AI API) | 1024 | API | Network-bound (~200ms/call) | Best quality; use if cost is acceptable |
| `text-embedding-3-small` (OpenAI API) | 1536 | API | Network-bound (~100ms/call) | Good quality; cheaper than voyage |

**For this hardware: start with `nomic-embed-code` via Ollama** (local, free, no GPU
needed for embeddings). Upgrade to `voyage-code-3` API if retrieval quality still
falls short after adding the cross-encoder reranker.

```bash
# Install and run in WSL2
ollama pull nomic-embed-code
```

### Vector Store: LanceDB (Recommended for Solo/Local)

For a solo developer on this hardware, avoid running a separate vector database server.
LanceDB embeds into your process, stores data on NVMe, and queries at 8–10ms warm latency.

```bash
npm install vectordb      # TypeScript binding for LanceDB
# or
pip install lancedb       # Python
```

If you outgrow LanceDB (>10M chunks, multi-user): migrate to **Qdrant** (self-hosted,
Docker, excellent filtering + vector performance).

### BM25 Index: Tantivy (via TypeScript binding)

```bash
npm install @tantivy/tantivy-wasm   # WASM port, runs in Node.js process — no server needed
```

**BM25 field boost for code** (apply to your BM25 schema):
```
symbol_name: boost=5.0   ← highest signal; exact function name matches
docstring:   boost=2.0
file_path:   boost=1.5
body:        boost=1.0
```

The `symbol_name` boost should be **5×**, not 3× (the generic recommendation). In code
search, matching an exact function name is the strongest retrieval signal available.

### Incremental Indexing Pipeline

```
File change detected (git hook or chokidar file watcher on WSL2 /workspace)
   │
   ▼
git diff --name-only HEAD  →  identify changed files only
   │
   ▼
Parse changed files with Tree-sitter  →  extract chunks + metadata
   │
   ▼
Embed changed chunks (nomic-embed-code via Ollama)
   │
   ▼
Upsert to LanceDB (chunk_id = hash(file_path + start_line))
   │
   ▼
Update Tantivy BM25 index (delete old doc for chunk_id, insert new)
```

**Never full-re-index on every save.** Diff-based incremental indexing keeps the hot
path under 200ms for typical single-file changes on NVMe.

Full re-index (background, scheduled every 30 minutes or on branch switch):
```bash
git diff --name-only main HEAD   # find all changed files vs base branch
# re-index only those files; rest stays valid
```

---

## Phase 3A Exit Criteria

Before starting Phase 3B, verify:

- [ ] **Model selected** with rationale documented (API vs local; tier assignment per task type)
- [ ] **Internal benchmark built**: 20+ representative tasks from your actual codebase, baseline scores recorded
- [ ] **Context pipeline designed**: strategy chosen (hybrid recommended), pipeline diagram drawn
- [ ] **Tree-sitter chunking implemented** and tested on your repo's primary language(s)
- [ ] **Embedding model chosen** and test-run on 100 chunks; latency measured
- [ ] **LanceDB + Tantivy initialised** with sample data; basic query latency measured
- [ ] **Incremental indexing** working end-to-end on file save (not full re-index)

**Phase 3A outputs:**
1. **Green** — all design decisions made and documented; implementation started; proceed to 3B
2. **Yellow** — model not benchmarked yet; note the gap and set a deadline before Phase 4
3. **Red** — context pipeline design not converged; do not proceed until resolved

---

*Continues in `phase3b-runtime.md` → Execution Sandbox, Inference Infrastructure,
Storage, Observability, and Spike Solutions 1–3.*
