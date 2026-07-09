# ADR-0026: Agent Skills Spec — SKILL.md with 3-Level Progressive Disclosure

**Status:** Accepted
**Phase:** P9
**Date:** 2026-07-03

## Context

The agent accumulates reusable procedures (skills) from successful task
trajectories. These skills need to be stored, discovered, and loaded
efficiently — without dominating the system prompt.

The Agent Skills specification (emerging industry standard, 9-month
ecosystem as of 2026) defines `SKILL.md` as the format: YAML
frontmatter + Markdown body + `scripts/`/`references/`/`assets/`
subdirectories.

## Decision

Adopt the **Agent Skills spec** with **3-level progressive disclosure**:

### SKILL.md Format

```markdown
---
name: "refactor-extract-function"
description: "Extract a code block into a named function"
trigger: ["refactor", "extract", "function"]
version: "1.0.0"
author: "agent"
lastImproved: "2026-07-03T..."
category: "refactoring"
---

# Extract Function Refactoring

## Steps
1. read_file the file...
2. edit_file to replace...
```

### 3-Level Progressive Disclosure

| Level | What | Tokens | When |
|-------|------|--------|------|
| L1 | Metadata (frontmatter only) | ~100/skill | Session start (system prompt) |
| L2 | Full instructions (body) | <5K | On trigger (agent decides to use) |
| L3 | Deep reference (scripts, refs) | On demand | When agent needs full detail |

### Why progressive disclosure?

Without it, 50 skills × 5K tokens each = 250K tokens of skill content
in every system prompt — 25% of the 1M context window. Progressive
disclosure keeps L1 at ~5K tokens total (50 × 100), and only loads L2
when a skill is actually triggered.

## Consequences

**Positive:**
- Skills compound value from real usage.
- L1 is cheap (~100 tokens/skill) — the agent knows what exists.
- L2 is loaded on-demand — no wasted context.
- Skills are versioned and auto-archived after 90 days.

**Negative:**
- Skills can become stale if not used. Mitigation: 90-day auto-archive.
- Self-written skills may contain errors. Mitigation: `author: "agent"`
  flag; human-authored seed skills are trusted.

## Implementation

- `packages/core/src/memory/skills/types.ts` — SkillMetadata, Skill,
  TrajectoryEntry, AUTO_ARCHIVE_DAYS=90, MAX_L2_TOKENS=5000
- `packages/core/src/memory/skills/writer.ts` — SkillWriter (creates
  skills from trajectories, 5+ tool call threshold, version increment)
- `packages/core/src/memory/skills/catalog.ts` — SkillCatalog (list,
  search, findByTriggers, delete)
- `packages/core/src/memory/skills/loader.ts` — SkillLoader (L1/L2/L3
  progressive disclosure, formatL1ForPrompt)
- `packages/core/src/memory/skills/archive.ts` — SkillArchiver (90-day
  auto-archive, archive/unarchive)
- `packages/core/src/memory/skills/index.ts` — SEED_SKILLS (5 pre-written
  skills: refactor, test, debug, review, git workflow)

## References

- Agent Skills specification (emerging standard, 2026)
- "MCP gave agents hands; Skills give them judgment"
- Upstream `module-5-memory-and-self-improvement.md` — skills section
