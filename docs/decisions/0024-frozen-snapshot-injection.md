# ADR-0024: Frozen Snapshot Injection for Persistent Memory

**Status:** Accepted
**Phase:** P8
**Date:** 2026-07-03

## Context

The persistent memory files (MEMORY.md, USER.md, PROJECT.md) contain
the agent's accumulated knowledge about the user, the project, and
general learnings. These are injected into the system prompt at session
start.

The risk: if the agent can modify its own memory mid-session, it can
rewrite its own constraints. For example, the agent could edit
MEMORY.md to add "I'm allowed to run rm -rf" and then proceed to do so.
This is a prompt-injection escape vector.

## Decision

Persistent memory is injected as a **frozen snapshot** at session start.
The snapshot is read-only — the agent CANNOT modify it mid-session.

### How it works

1. **Session start**: `PersistentMemory.takeSnapshot()` reads all three
   files and returns a `MemorySnapshot` object.
2. **System prompt**: The `SystemPromptAssembler` injects the snapshot
   as a read-only block (Fragment 7: memory).
3. **During session**: The agent records new learnings to Tier 1
   (session memory), NOT to the persistent files.
4. **Session end**: The `MemoryCurator` runs, extracts learnings from
   session memory, and updates the persistent files within budget.

### Why not allow direct writes?

- **Safety**: prevents the agent from rewriting its own constraints.
- **Consistency**: the snapshot is stable for the entire session —
  the agent's behavior is based on the same memory throughout.
- **Curation**: the curator can make informed decisions about what's
  worth keeping (deduplication, priority, budget) that the agent can't
  make mid-session.

## Consequences

**Positive:**

- The agent cannot rewrite its own memory to escape constraints.
- Memory is stable for the entire session.
- The curator makes informed curation decisions at session end.

**Negative:**

- Within-session learnings are not immediately available in the system
  prompt (they're in Tier 1 session memory instead). Mitigation: session
  memory is searchable via the `VectorMemoryPlugin`.
- The curator runs only at session end — if the session crashes,
  learnings are lost. Mitigation: session memory is persisted to disk
  (Phase 10 trajectory logging).

## Implementation

- `packages/core/src/memory/persistent/files.ts` — `takeSnapshot()`
  method returns a `MemorySnapshot`
- `packages/core/src/agent/system-prompt.ts` — Fragment 7 (memory)
  injects the snapshot as a read-only block
- `packages/core/src/memory/session/ephemeral.ts` — `SessionMemory`
  stores within-session learnings (Tier 1)
- `packages/core/src/memory/curator/agent.ts` — `MemoryCurator` runs
  at session end to update persistent files

## References

- Hermes agent pattern (frozen snapshot injection)
- Upstream `module-5-memory-and-self-improvement.md` — memory section
