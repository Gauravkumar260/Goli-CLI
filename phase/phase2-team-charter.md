# Phase 2: Goli_CLI Solo Operating Model

**Date:** 2026-05-30 | **Status:** 🟢 Green  
**Model:** Solo student developer  
**Budget:** $0–20/month (Gemini free tier for inference + embeddings; paid API for benchmarking only)  
**Next phase:** Phase 3 (AI Infrastructure) — do not begin before Week 4 end-gate passes

---

## Context Shift From Phase 1

Phase 1 was scoped for a small team. C3 revealed solo student context. This changes three things:

- No hiring plan. No RACI. No stakeholder updates.
- The 12-week timeline is a personal commitment, not a team coordination problem.
- Every role (Agent Eng, ML Eng, Safety, DevRel, Infra) is **you** — so the question isn't "who owns what" but "in what order do you work on which hat."

The Phase 2 document that actually serves you is the **4-week build order** plus a set of decision rules that prevent you from wasting time on the wrong things when you're tired.

---

## Hat Map and Time Allocation

You wear all hats. Here's how to think about the time split across a typical week:

| Hat | % of time | What it means in practice |
|---|---|---|
| Agent / Context Engineer | 60% | Writing the actual code |
| Eval Engineer | 20% | Writing and running evals — never skip this |
| Product (yourself as PM) | 10% | Using Goli_CLI on a real task; noticing what's broken |
| Safety (yourself as reviewer) | 5% | Read every diff the agent produces before committing |
| DevRel (social / README) | 5% | Not until you have something worth showing (Week 6+) |

**Rule**: If eval time drops below 15%, you're accumulating debt. The eval harness is how you know if the thing you just built actually works.

---

## Four Architecture Rules (Inviolable)

Carried from Phase 1. Violating any of these in an early commit is a decision that compounds badly:

1. **Every model call goes through `ModelProvider` interface.** No direct `genAI.getGenerativeModel()` calls in agent code. If you hardcode a provider in `agent.ts`, refactor it before merging.
2. **Context retrieval quality is the product.** If a feature choice is "better agent loop" vs. "better retrieval," choose retrieval.
3. **No new capability without an eval that measures it.** Write the test first. Then implement.
4. **Evals run before public commits.** If `npm run eval` regresses from last baseline, the commit doesn't merge.

---

## Decision Rules for Hard Calls (Solo Dev Edition)

You will hit moments at 11pm where you need to decide something fast without a tech lead to ask. These rules replace that conversation:

| Situation | Rule |
|---|---|
| "Should I build X or Y first?" | Whichever one blocks more downstream work. If neither blocks the other: retrieval > agent loop > tooling > UX. |
| "Should I add a feature that's out of scope?" | Write it in `BACKLOG.md` and close the tab. Do not implement. |
| "The context engine isn't working perfectly, should I move on?" | Only if retrieval Precision@5 > 0.65 on your golden set. Below that: fix retrieval, not the loop. |
| "Should I add a new model provider this week?" | Not until the Gemini path is production-quality. One working path beats two half-working ones. |
| "Should I publish/share what I have?" | Not until you can run `goli_cli run "add input validation to the User model"` on a real repo and get a correct diff. |

---

## The 4-Week Build Order

This is the most important output of Phase 2. The order is non-negotiable — each week is gated on the previous week's deliverable.

---

### Week 1 — Skeleton: ModelProvider + GeminiProvider + CLI (Days 1–7)

**Goal**: `goli_cli run "write a function that reverses a string"` works on your machine using the Gemini API.

**What to build:**
```
src/
  cli.ts               # CLI entry: parses args, calls run()
  providers/
    ModelProvider.ts   # Interface: complete(messages) → string
    GeminiProvider.ts  # Concrete adapter: calls Gemini API via @google/generative-ai
  run.ts               # Core entry: takes task string, calls provider, returns response
```

**What NOT to build yet:** tool layer, context retrieval, sandbox, git integration, other model providers. None of it. Just the skeleton.

**Technology decisions (lock these now):**
- Language: TypeScript
- Build: Bun (faster than Node for CLI; used by Claude Code for same reasons)
- Inference model: `gemini-2.0-flash` via Gemini free tier API (`GEMINI_API_KEY`)
- npm package: `@google/generative-ai`
- Embedding model: `text-embedding-004` via same Gemini API key (same free tier quota)

**Week 1 end-gate** — must pass before Week 2:
```bash
# This command must work on your machine (requires GEMINI_API_KEY env var)
goli_cli run "write a function that reverses a string in Python"
# Expected: model returns a Python function. No hallucination about its own tool layer.
```

**Time estimate**: 2–3 evenings. If it's taking longer, you're over-engineering the skeleton.

---

### Week 2 — Context Retrieval Engine (Days 8–14)

**Goal**: `goli_cli init` indexes a repo; `goli_cli search "auth module"` returns correct files in top-3 results.

This is where you build the actual moat. Spend more time here than anywhere else.

**What to build:**
```
src/
  indexer/
    parser.ts          # Tree-sitter: chunk at function/class boundaries, not line counts
    embedder.ts        # Call Gemini text-embedding-004 API for each chunk
    store.ts           # LanceDB: store chunk + embedding + metadata (file, start line, end line)
  retriever/
    search.ts          # Vector similarity search: query → top-N chunks with scores
  commands/
    init.ts            # Walk repo, parse, embed, index. Shows progress.
    search.ts          # CLI command: goli_cli search "query"
```

**Technology decisions:**
- Chunker: `tree-sitter` + language grammars for Python, TypeScript, Go (Rust if time allows)
- Vector DB: `lancedb` — embedded (no server), Apache 2.0, works locally with no Postgres dependency
- Embedding model: `text-embedding-004` via Gemini API (same `GEMINI_API_KEY`; free tier: 1,500 req/day)
- Chunk target: 200–400 tokens per chunk (larger = less precision; smaller = loses context)

**Free tier note on embeddings**: indexing `expressjs/express` (~30k LOC) produces ~500–800 chunks — one `goli_cli init` run uses roughly half the daily quota. After initial index, only re-index changed files. Daily cost in normal dev flow: near zero.

**Critical implementation note**: Do NOT chunk by line count. Parse with Tree-sitter, find function/class boundaries, split there. A function that spans lines 45–120 is one chunk. Two functions on lines 1–44 and 121–180 are two chunks. If you chunk by lines, you split functions mid-body and retrieval quality collapses.

**Week 2 end-gate** — must pass before Week 3:
```bash
# On a real repo (clone expressjs/express or fastapi/fastapi)
goli_cli init
goli_cli search "route handler middleware"
# Expected: returns the actual middleware file(s) in top-3, not random utility files
# If it returns obviously wrong files: do not proceed to Week 3. Fix the chunking.
```

**Time estimate**: 4–5 evenings. Tree-sitter setup and LanceDB schema take most of the time.

---

### Week 3 — Eval Harness + Golden Set + Baseline (Days 15–21)

**Goal**: Know your retrieval engine's Precision@5 before building the agent loop. If you skip this week and go straight to the loop, you will spend weeks debugging a broken product without knowing whether the problem is the retrieval or the loop.

**What to build:**

**Part A — Golden set** (do this first, 1–2 evenings):
- Pick a real OSS repo in the 20k–80k LOC range. Good choices: `expressjs/express`, `fastapi/fastapi`, `gin-gonic/gin`, `sirupsen/logrus`.
- Write 15 task descriptions in `evals/golden-set.json`. This grows to 50 tasks by Phase 3 exit — 15 is enough to validate retrieval quality now, not enough to gate sandbox enablement later.

```json
[
  {
    "id": "task-001",
    "description": "Add input validation to the createUser function that checks email format",
    "expected_files": ["src/users/user.service.ts", "src/users/user.dto.ts"],
    "expected_operations": ["modify", "modify"]
  },
  ...
]
```

- Tasks should be multi-file. Single-file tasks don't stress the retrieval engine.
- 15 tasks × ~20 minutes each to write = one evening.

**Part B — Retrieval eval runner** (1 evening):
```
evals/
  golden-set.json      # Your 15 tasks
  run-retrieval.ts     # For each task: retrieve top-5 chunks, check if expected_files appear
  metrics.ts           # Precision@5: what fraction of expected files appear in top-5 results?
```

Run it as: `bun run evals/run-retrieval.ts`

**Part C — Baselines** (1 evening):
Run retrieval against each of your 15 tasks. Record:
- Precision@5 with your context engine
- What the model says with **no context** (baseline 0)
- What the model says with **full file dump** (naive approach)

This gives you a comparison table. If your context engine doesn't beat full file dump on Precision@5, your chunking or embedding is broken. Fix it here, not in Week 4.

**Week 3 end-gate** — must pass before Week 4:
```
Retrieval Precision@5 > 0.65 on your 15-task golden set.
```
If below 0.65: do not proceed. Diagnose: is it the chunker? The embedding model? The similarity threshold? Fix it. Week 4 is blocked until this passes.

This threshold is lower than the Phase 1 target (0.80) because your golden set is small (15 tasks) and your model is quantized. You'll raise the bar as both improve.

---

### Week 4 — Core Agent Loop (Days 22–28)

**Goal**: `goli_cli run "add input validation to the createUser function"` on your golden set repo produces a correct multi-file diff.

You now have: (a) working inference, (b) working retrieval, (c) a baseline to measure against. Now build the loop.

**What to build:**
```
src/
  agent/
    loop.ts            # While-loop: retrieve → prompt → parse → dispatch → observe → repeat
    prompt.ts          # Build the system prompt + task + retrieved context
    parser.ts          # Parse model output: detect tool calls vs. final answer
    compaction.ts      # Trim old turns when context grows > 80% of limit
  tools/
    ToolRegistry.ts    # Maps tool name → handler function
    file_read.ts       # Read file contents; returns string
    file_write.ts      # Write file; records to pending diff
    shell_exec.ts      # Run shell command; NO sandbox yet — work in git branch
    run_tests.ts       # Run project test suite; returns pass/fail + output
  diff/
    DiffManager.ts     # Track all writes; produce unified diff on request
  commands/
    run.ts             # goli_cli run: entry point for the agent loop
    diff.ts            # goli_cli diff: show pending changes
    commit.ts          # goli_cli commit: apply pending diff and git commit
```

**Key agent loop design:**
```
function agentLoop(task: string): Diff {
  let turns = 0
  let context = await retrieve(task, topK=8)
  let history = []

  while (turns < 10) {
    const response = await model.complete(buildPrompt(task, context, history))
    const action = parseAction(response)

    if (action.type === "DONE") return diffManager.getDiff()
    if (action.type === "TOOL_CALL") {
      const result = await tools.dispatch(action)
      history.push({ role: "tool", content: result })
      // Re-retrieve if tool result suggests new relevant files
      if (shouldRetrieve(result)) context = await retrieve(result.summary, topK=5)
    }
    turns++
  }
  return diffManager.getDiff() // Return whatever was produced, even if incomplete
}
```

**No sandbox in Week 4.** Run `git checkout -b goli_cli/task-xxx` before every task, do all writes in that branch. Full Docker sandbox is Phase 3. Sandboxing before you have a working loop adds 3 days of complexity for no quality benefit.

**shell_exec restriction until Phase 3 sandbox is live:** Limit to `git`, test runners (`pytest`, `jest`, `go test`, `cargo test`), and read-only commands (`grep`, `find`, `cat`). Do not enable arbitrary shell execution. One destructive command on your own codebase before the sandbox exists will cost you more time than the sandbox would have taken to build.

**After building, immediately run your golden set:**
```bash
bun run evals/run-agent.ts
# Reports pass@1 for each of your 15 tasks
```

**Week 4 end-gate** — Phase 3 unlock:
```
pass@1 > 30% on your 15-task golden set.
```
This is not a high bar. It means 5 out of 15 tasks produce a correct diff on the first attempt. If you're below 30%, the most common causes are:
1. Retrieval is still weak (fix the chunker)
2. Prompt structure is unclear (model doesn't know what tools to call)
3. Tool output parsing is broken (model output format doesn't match your parser)

Diagnose from your trajectory logs before concluding "the model is too weak." 7B models with good context routinely beat 70B models with no context on real tasks.

---

## Dogfooding Trigger

**Start using Goli_CLI to build Goli_CLI at the beginning of Week 4.**

Not earlier — you need a working loop before you can dogfood the loop. Once `goli_cli run` produces diffs, use it for:
- Writing tests
- Refactoring utility functions
- Debugging your own retrieval engine

If you find yourself not trusting the output, that's a signal. Log what failed and add it to the golden set.

Claude Code hit 50% internal adoption on day 1. That's because it was already working at launch. Don't ship before it's useful for you.

---

## Weekly Operating Rhythm

This replaces the standup/sprint structure from the team template.

| Day | Activity |
|---|---|
| **Monday** | Review eval results from last week. Write the task for this week in one sentence. |
| **Tue–Thu** | Build. Eval gate runs on Thursday before you continue. |
| **Friday** | Use Goli_CLI on a real task. Log what broke. Update golden set if a new failure mode appeared. |
| **Weekend** | Optional. Don't burn out. If you're stuck, write an ADR about the decision you can't make — the writing often resolves it. |

**ADR rule**: Any architectural decision that you debate with yourself for >20 minutes becomes an `docs/adr/ADR-NNN-title.md`. Template:
```markdown
# ADR-001: Use LanceDB over pgvector

**Status:** Accepted
**Date:** 2026-05-30
**Context:** Need a vector store that works locally without Postgres.
**Decision:** LanceDB — embedded, Apache 2.0, 8–10ms warm latency.
**Consequences:** No Postgres dependency. Limits future multi-user server deployment (pgvector is better there). Acceptable for V1.
```

---

## External Dependencies

| Dependency | What you need | Risk |
|---|---|---|
| Gemini API | `GEMINI_API_KEY` set; free tier active (1,500 req/day inference + embeddings) | Low — you control the key; free tier sufficient for solo dev |
| `@google/generative-ai` npm package | Inference (`gemini-2.0-flash`) + embeddings (`text-embedding-004`) | Low — official Google SDK, stable |
| Tree-sitter npm packages | `tree-sitter`, `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-go` | Low — stable, versioned |
| LanceDB | `@lancedb/lancedb` npm package | Medium — actively developed; pin version |
| Target OSS repo for golden set | Clone of `expressjs/express` or equivalent | Low — public, stable |
| Docker (Week 5+) | Not needed until Phase 3 sandbox | N/A this phase |

---

## Open Risks

None carried from Phase 1. All three exit conditions (C1, C2, C3) are closed as of 2026-05-30.

---

## Phase 2 Exit Criteria — All Must Be True Before Phase 3

- [ ] Week 4 end-gate passes: `pass@1 > 30%` on 15-task golden set
- [ ] `ModelProvider` interface exists; `GeminiProvider` is the only concrete adapter (adding Claude/GPT-4o is Phase 3)
- [ ] LanceDB embedding index is working; `goli_cli init` and `goli_cli search` are functional
- [ ] 15-task golden set exists in `evals/golden-set.json`
- [ ] Retrieval Precision@5 > 0.65 on the golden set
- [ ] Eval runner exists and is wired into commit hook (or at minimum `npm run eval` runs it)
- [ ] At least one ADR written (the LanceDB vs. pgvector decision is a good first one)
- [ ] `goli_cli run`, `goli_cli diff`, `goli_cli commit` commands are functional
- [ ] Goli_CLI.md (project context file) format is documented, even if not yet consumed by the agent
- [ ] You have successfully used Goli_CLI to make at least one real change to Goli_CLI's own codebase

**Status: 🟢 Green** — proceed to Phase 3 when all exit criteria pass.

Phase 3 adds: Docker sandbox, permission + safety classifier, additional model providers (Claude, GPT-4o, Ollama for local/offline), MCP tool layer, context compaction improvements, and raises the golden set to 50 tasks.
