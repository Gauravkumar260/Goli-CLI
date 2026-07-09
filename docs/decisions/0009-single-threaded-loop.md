# ADR-0009: Single-Threaded Master Loop Over Multi-Agent DAGs

**Status:** Accepted
**Phase:** P2
**Date:** 2026-07-03

## Context

The upstream GOLI-CLI spec is explicit: "Single-threaded loop over
multi-agent DAGs (DAGs deferred to Module 5; multi-agent burns ~15×
tokens, ~37% coordination bugs)."

The user's project description names an "11-agent swarm" (Scout →
Researcher → Architect → Planner → Implementer → Debugger → QA/Tester →
Security Auditor → Reviewer → Orchestrator → Documenter). This sounds
like it conflicts with the single-threaded recommendation — but it
doesn't.

## Decision

GOLI-CLI uses a **single-threaded ReAct master loop** as the execution
primitive. The 11-agent swarm is an **orchestration pattern** built on
top of the loop, not a replacement for it.

### The distinction

- **The loop (Module 1, Phase 2)**: One agent instance runs at a time.
  It calls GLM-5.2, gets a response, executes tool calls, repeats. This
  is the `AgentLoop` class in `packages/core/src/agent/loop.ts`.

- **The swarm (Module 7, Phase 13)**: The orchestrator runs the 11
  agents **sequentially** (Scout → Researcher → ... → Documenter), each
  as a separate `AgentLoop` instance with a specialized system prompt
  and tool set. Each agent's output is the next agent's input context.
  This is a **pipeline**, not a parallel DAG.

### Why not parallel?

1. **Token cost**: Parallel multi-agent burns ~15× tokens vs. single-
   thread (upstream spec).
2. **Coordination bugs**: 36.94% of AutoGen/CrewAI/LangGraph failures
   are coordination failures (upstream spec).
3. **Error compounding**: Errors compound silently across parallel
   stages with no stack trace.
4. **GLM-5.2's 1M context**: The bar for "is this genuinely too big
   for one agent?" is much higher with a 1M-token window.

### When parallel IS appropriate (Phase 13)

Phase 13 (Module 7) will add **opt-in parallel subagents** for genuinely
independent subtasks (e.g. "implement feature A and feature B in
parallel"). These use:
- Git worktree isolation (one branch per subagent)
- File-based shared-blackboard coordination (propose-validate-commit)
- A supervisor/arbiter that reviews intermediate outputs

But this is **opt-in, not default**. The default workflow is the
sequential 11-agent pipeline.

## Consequences

**Positive:**
- 15× lower token cost than default-multi-agent.
- 37% fewer coordination failures.
- Simpler debugging (one stack trace, one conversation).
- The 11-agent swarm is still expressible — just sequential.

**Negative:**
- Wall-clock time is longer for tasks that could be parallelized.
  Mitigation: Phase 13 adds opt-in parallelism.
- The "swarm" branding might mislead users into expecting parallel
  execution. Mitigation: `goli doctor` and `goli status` will show
  the current pipeline stage.

## Implementation

- `packages/core/src/agent/loop.ts` — `AgentLoop` class (Phase 2)
- `packages/core/src/agent/types.ts` — `AgentRole` type with all 11
  roles + `AGENT_ROLES` array in lifecycle order
- `packages/core/src/agent/system-prompt.ts` — assembles role-specific
  prompts (Phase 2: orchestrator; Phase 13: all 11)
- Phase 13: `packages/core/src/orchestration/pipeline.ts` — runs the
  11 agents in sequence

## References

- Upstream `module-1-agent-core-loop.md` — single-threaded loop section
- Upstream `module-7-multi-agent-orchestration.md` — restraint section
- MIT Simchi-Levi: centralized control dominates delegated acyclic networks
