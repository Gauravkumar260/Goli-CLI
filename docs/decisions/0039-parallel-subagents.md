# ADR-0039: Parallel Sub-Agents (H15)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H15 — Parallel Sub-Agents
**Supersedes:** ADR-0035 (sequential pipeline) — partially. ADR-0035's
default (sequential) is preserved; this ADR adds *opt-in* parallelism.

## Context

ADR-0035 chose a sequential 11-agent pipeline as the default
orchestration pattern, citing a 15× token cost for parallel sub-agents
(each subagent has its own context window). The cost concern is valid
as a *default* — most tasks are not parallelizable enough to justify
the overhead.

However, ADR-0035 also blocked *opt-in* parallelism, which is a
competitive gap:

- **Claude Code** supports parallel sub-agents with git worktree
  isolation. Users explicitly opt in via `spawn_subagent`.
- **Cursor** Composer mode parallelizes multi-file edits.
- **Devin** uses parallel sub-agents as its core concurrency model.

For tasks with genuinely independent subtasks (e.g., "implement the
auth module + implement the user module + write API tests"), sequential
execution wastes wall-clock time. `max(t_i)` beats `sum(t_i)` when the
subtasks are similar in duration.

## Decision

Add **opt-in parallel sub-agents** via a new `spawn_subagent` tool:

### Tool

`spawn_subagent` takes:
- `prompt` (required) — the subtask prompt
- `role` (required) — the agent role (implementer, qa-tester, etc.)
- `use_worktree` (default true) — whether to create a git worktree
- `subagent_id` (optional) — for later reference
- `branch_name` (optional) — auto-generated if not provided

### Parallel execution

`spawn_subagent` is moved from `NEVER_PARALLEL_TOOLS` to
`PARALLEL_SAFE_TOOLS`. When the model emits multiple `spawn_subagent`
calls in one turn, they execute concurrently (max 8, per
`MAX_CONCURRENT_TOOLS`). Each runs in its own git worktree — no file
conflicts.

### Merge protocol

Sub-agent results are NOT auto-merged. The tool returns a summary
(subagent ID, branch name, worktree path, content). The main agent
must explicitly merge the branch (via `bash` git commands, or a
future `merge_subagent` tool). This forces the main agent to review
the subagent's diff before merging — preventing unwanted changes from
landing on the target branch.

### Tool context callback

The actual subagent spawn is delegated to `ctx.spawnSubagent`, which
the agent loop provides. This keeps the tool layer decoupled from the
agent loop construction (mirrors H14's `requestDiffApproval` pattern).
When the callback is not set (e.g., in unit tests or when the agent
loop was not configured with a spawner), the tool throws with a
helpful message.

### Default unchanged

ADR-0035's default (sequential pipeline) is preserved. The
`SwarmPipeline` still runs sequentially by default. `spawn_subagent`
is an *opt-in* escape hatch for genuinely parallel tasks. The system
prompt guides the model to use it only when subtasks are independent.

## Consequences

**Positive:**

- Closes the parallelism gap vs Claude Code, Cursor, and Devin.
- Independent subtasks finish in `max(t_i)` instead of `sum(t_i)`.
- Git worktrees provide filesystem isolation (no file conflicts).
- The merge protocol forces explicit review before landing changes.
- Backward-compatible: the tool is registered but inert when no
  `spawnSubagent` callback is provided.

**Negative:**

- Each subagent has its own context window — token cost is `N ×`
  the sequential cost (where N is the number of parallel subagents).
  Mitigation: the system prompt guides the model to use
  `spawn_subagent` only for genuinely independent subtasks.
- Worktree creation has overhead (~1s per worktree). Mitigation: for
  read-only subtasks, set `use_worktree: false`.
- The merge protocol adds a step. The main agent must remember to
  merge — if it forgets, the work sits in a branch. Mitigation: a
  future `merge_subagent` tool (or auto-merge at session end).
- Worktrees are NOT a security boundary (ADR-0036). Untrusted
  subagent code must still be sandboxed via Module 4.

## Alternatives Considered

### A. Auto-parallelize the sequential pipeline

Rejected: the 11-agent swarm has explicit handoffs (Scout →
Researcher → Architect → ...). Parallelizing breaks the handoff
semantics.

### B. Auto-merge subagent results

Rejected: auto-merge bypasses review. The whole point of the merge
protocol is to force the main agent to look at the diff before
landing it.

### C. Worker threads for sub-agents

Deferred: subagents currently share the event loop. For CPU-bound
subagents (e.g., tree-sitter parsing), worker threads would help.
But the bottleneck is usually the LLM call (I/O-bound), not the
agent loop itself. Worker threads add complexity (message passing,
state serialization) for marginal gain.

## Implementation

- `packages/core/src/tools/core/spawn-subagent.ts` — `SPAWN_SUBAGENT_TOOL`,
  `SubagentSpawnInput`, `SubagentResult`
- `packages/core/src/tools/types.ts` — `ToolContext.spawnSubagent`
- `packages/core/src/tools/parallel-execution.ts` — moved
  `spawn_subagent` from `NEVER_PARALLEL_TOOLS` to `PARALLEL_SAFE_TOOLS`
- `packages/core/src/tools/index.ts` — register the new tool (count 16 → 17)
- `tests/unit/parallel-subagents.test.ts` — 11 unit tests
- `tests/unit/tool-registry.test.ts` — updated count 16 → 17

## Follow-up

- Wire `spawnSubagent` callback in `AgentLoop` (construct a child
  `AgentLoop` with the given role, optionally create a worktree via
  `WorktreeIsolation`).
- Add `merge_subagent` tool for explicit merge + cleanup.
- Add `list_subagents` tool to query active subagents.
- Add a budget multiplier for parallel subagents (track N × cost).
