# Phase 9 — Skill Accumulation (Module 5, part 2)

**Status:** Pending
**Modules touched:** M5 (skill accumulation)
**Compliance gates:** none new

## Goal

Build the skill writer (`SKILL.md` with YAML frontmatter), catalog,
3-level progressive disclosure (L1 metadata / L2 instructions / L3 deep
reference), 5-10 seed skills, and 90-day auto-archive.

## Definition of Done

- [ ] `src/memory/skills/writer.ts` — writes SKILL.md from trajectories (5+ tool-call trigger)
- [ ] `src/memory/skills/catalog.ts` — `~/.agent/skills/` index
- [ ] `src/memory/skills/loader.ts` — 3-level progressive disclosure
- [ ] `src/memory/skills/archive.ts` — 90-day auto-archive (last_improved timestamps)
- [ ] `src/memory/skills/seed/` — 5-10 seed skills (YAML + Markdown)
- [ ] Wire skill loader into system prompt assembler (L1 metadata at startup)
- [ ] ADR-0026 (Agent Skills spec adoption)
- [ ] ADR-0027 (3-level progressive disclosure)

## Steps (P9.x)

9.1 Write `src/memory/skills/writer.ts` (analyzes trajectory, extracts pattern, writes SKILL.md)
9.2 Write `src/memory/skills/catalog.ts` (index of all skills)
9.3 Write `src/memory/skills/loader.ts` (L1=frontmatter only, L2=full instructions, L3=references)
9.4 Write `src/memory/skills/archive.ts` (90-day rule based on last_improved)
9.5 Write 5-10 seed skills in `src/memory/skills/seed/`
9.6 Wire L1 metadata into SystemPromptAssembler
9.7 Write tests: writer pattern extraction, loader levels, archive rule
9.8 ADR-0026, ADR-0027
9.9 Worklog entry for Phase 9

## Key Engineering Decisions

- **Self-writing skills (no hand-coding).** Creates compounding value from
  real usage. Risk: stale skills → mitigate via `last_improved` timestamps
  and 90-day auto-archive.
- **3-level progressive disclosure.** L1 = ~100 tokens/skill at startup
  (just frontmatter). L2 = full instructions <5K tok on trigger. L3 = deep
  reference on demand.
- **Agent Skills spec.** YAML frontmatter + Markdown body + `scripts/`,
  `references/`, `assets/` subdirs.
