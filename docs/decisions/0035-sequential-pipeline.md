# ADR-0035: Sequential 11-Agent Pipeline Over Parallel Swarm

**Status:** Accepted
**Phase:** P13
**Date:** 2026-07-03

## Context

The 11-agent swarm (Scout → Documenter) could run in parallel or
sequentially. Research shows:
- Multi-agent burns ~15× more tokens than single-thread
- 36.94% of AutoGen/CrewAI/LangGraph failures are coordination failures
- GLM-5.2's 1M context raises the bar for "too big for one agent"
- Open mesh (swarm) has 87% failure rate

## Decision

The 11-agent swarm runs **sequentially** (handoff pattern) by default.
Each agent's output is the next agent's input context. Parallel
execution (fan-out/fan-in) is opt-in for genuinely independent subtasks.

## References

- MIT Simchi-Levi: centralized control dominates delegated acyclic networks
- Upstream `module-7-multi-agent-orchestration.md`
