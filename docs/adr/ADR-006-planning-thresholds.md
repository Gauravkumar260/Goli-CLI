# ADR-006: Deliberative Planning Thresholds

## Status
Accepted (2026-05-31)

## Context
Running a planning phase for every simple task (e.g., "read this file") adds unnecessary latency and cost (~$0.01 and 5-10s per session). However, failing to plan for complex tasks (e.g., "refactor this module") leads to aimless loops and context overflow.

## Decision
1. **Multi-Signal Heuristic**: Planning is triggered only when two or more of the following conditions are met:
    - Task description > 20 words.
    - Presence of "structural" keywords: `migrate`, `refactor`, `rename`, `global`.
    - Presence of multi-step conjunctions: `and then`, `after that`, `finally`.
    - Reference to multiple files: `all files`, `every usage`.
2. **Haiku for Planning**: The planning phase uses `gemini-flash-lite` (or Haiku) to keep costs low.
3. **Manual Override**: The `--plan` flag always forces a planning phase.

## Rationale
- **Efficiency**: Most agent tasks are simple reads or single-file edits. Skipping planning by default saves resources.
- **Complexity Detection**: The "2-signal" rule is a balance between false positives (planning for simple things) and false negatives (diving into complex things without a map).

## Consequences
- The agent may occasionally dive into a multi-turn task without a plan if the heuristic fails.
- Users are encouraged to use the `--plan` flag for complex refactors.
