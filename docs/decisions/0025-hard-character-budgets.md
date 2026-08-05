# ADR-0025: Hard Character Budgets for Memory Files

**Status:** Accepted
**Phase:** P8
**Date:** 2026-07-03

## Context

Without limits, persistent memory files (MEMORY.md, USER.md,
PROJECT.md) grow unboundedly across sessions. After 100 sessions, the
files could contain 50K+ characters — dominating the system prompt and
degrading the agent's attention.

The upstream Module 5 spec (Hermes pattern) mandates hard character
budgets to force curation.

## Decision

Each memory file has a **hard character budget**:

| File       | Budget (chars) | ~Tokens   | Purpose                                 |
| ---------- | -------------- | --------- | --------------------------------------- |
| MEMORY.md  | 2200           | ~800      | General agent memory (learnings, facts) |
| USER.md    | 1375           | ~500      | User preferences                        |
| PROJECT.md | 2000           | ~700      | Project-specific context                |
| **Total**  | **5575**       | **~2000** |                                         |

When content exceeds the budget, it is truncated from the END (keeping
the beginning, which is usually the most important / oldest memories)
with a `[... truncated ...]` marker.

## Consequences

**Positive:**

- Memory files never dominate the system prompt (~2000 tokens out of
  1M context = 0.2%).
- The agent is forced to curate — it must decide what's worth keeping.
- Predictable prompt size across sessions.

**Negative:**

- Old memories are lost when the budget is exceeded. Mitigation: the
  curator prioritizes by category (bugs > decisions > preferences >
  facts > learnings > context) and by recency.
- 2000 tokens is tight for complex projects. Mitigation: PROJECT.md is
  per-repo, so each project gets its own budget. The external memory
  plugin (Tier 3) provides unlimited storage for less-important
  learnings.

## Implementation

- `packages/core/src/memory/types.ts` — `MEMORY_BUDGETS` constant
- `packages/core/src/memory/persistent/files.ts` — `save()` enforces
  the budget with truncation marker
- `packages/core/src/memory/curator/agent.ts` — curator writes within
  budget, prioritizing high-priority entries

## References

- Hermes agent pattern (character budgets)
- Upstream `module-5-memory-and-self-improvement.md` — budget section
