# Phase 8 — Memory System (Module 5, part 1)

**Status:** Pending
**Modules touched:** M5 (3-tier persistent memory)
**Compliance gates:** none new

## Goal

Build the three-tier persistent memory (session / persistent / external).
`MEMORY.md` (~800 tokens), `USER.md` (~500 tokens), `PROJECT.md` per
repo. Frozen-snapshot injection at session start (Hermes pattern).
Memory curator agent at session end.

## Definition of Done

- [ ] `src/memory/persistent/memory-files.ts` — bounded markdown files (2200/1375/2000 char budgets)
- [ ] `src/memory/persistent/snapshot.ts` — frozen snapshot injection at session start
- [ ] `src/memory/persistent/paths.ts` — `~/.agent/memories/{MEMORY,USER}.md` + `./PROJECT.md`
- [ ] `src/memory/session/ephemeral.ts` — in-session learnings (cleared per session)
- [ ] `src/memory/external/vector-plugin.ts` — Tier 3 vector recall (uses Module 2 LanceDB)
- [ ] `src/memory/curator/agent.ts` — session-end extraction within budgets
- [ ] `src/memory/curator/prompts.ts` — extraction prompts
- [ ] Character budgets enforced (2200 / 1375 / 2000)
- [ ] Wire memory snapshot injection into system prompt assembler (Phase 2)
- [ ] ADR-0024 (frozen snapshot injection prevents in-session rewriting)
- [ ] ADR-0025 (hard character budgets force curation; Hermes pattern)

## Steps (P8.x)

8.1 Write `src/memory/persistent/paths.ts` (~/.agent/memories/ + ./PROJECT.md)
8.2 Write `src/memory/persistent/memory-files.ts` (load, save, enforce char budget)
8.3 Write `src/memory/persistent/snapshot.ts` (frozen snapshot at session start)
8.4 Write `src/memory/session/ephemeral.ts`
8.5 Write `src/memory/external/vector-plugin.ts`
8.6 Write `src/memory/curator/agent.ts` + `prompts.ts`
8.7 Wire memory snapshot into SystemPromptAssembler (Phase 2)
8.8 Wire curator to run on session end (in AgentLoop shutdown)
8.9 Write tests: budget enforcement, snapshot injection, curator extraction
8.10 ADR-0024, ADR-0025
8.11 Worklog entry for Phase 8

## Key Engineering Decisions

- **Three tiers.** Session (ephemeral) + Persistent (bounded markdown) +
  External (vector DB). Hermes-derived pattern.
- **Frozen snapshot injection.** Prevents the agent from rewriting its
  own memory mid-session to escape constraints. Tradeoff: blocks within-
  session learning. Mitigation: session memory (Tier 1) handles in-session
  learnings.
- **Hard character budgets.** MEMORY.md=2200 chars (~800 tok),
  USER.md=1375 chars (~500 tok), PROJECT.md=2000 chars (~700 tok).
  Forces curation, prevents unbounded memory growth.
- **Memory at `~/.agent/memories/`** (user-level) + `./PROJECT.md` (per-repo).
