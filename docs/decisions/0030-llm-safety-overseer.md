# ADR-0030: LLM-Based Safety Overseer with Veto Power

**Status:** Accepted
**Phase:** P11
**Date:** 2026-07-03

## Context

The immutable safety registry (ADR-0029) protects known critical files.
But SICA proposals can be subtle — a change that doesn't directly modify
a protected file might still weaken safety indirectly (e.g. removing a
call to a safety function, or changing a prompt to instruct the model
to ignore safety rules).

Pattern-based detection catches obvious cases (removing "block_destructive",
changing "read-only" to "danger-full-access"). But novel evasion
strategies require semantic understanding.

## Decision

GOLI-CLI implements an **LLM-based safety overseer** — a separate
GLM-5.2 instance that reviews every SICA proposal and has veto power.

### How it works

1. The SICA loop generates a proposal (the main agent proposes a change).
2. The overseer (a different GLM-5.2 instance with a safety-focused
   system prompt) reviews the proposal.
3. The overseer checks for: safety_check_disabled, sandbox_boundary_expanded,
   logging_removed, approval_weakened, immutable_registry_modified,
   hardcoded_answer, benchmark_overfitting.
4. If the overseer vetoes, the proposal is automatically rejected —
   no human intervention needed.

### Why a separate LLM instance?

The proposing model cannot "approve its own hacks." The overseer uses
a different system prompt focused solely on safety review, with no
incentive to approve changes that improve benchmark scores at the
expense of safety.

### Fallback

If the LLM client is unavailable, the overseer falls back to pattern-
based detection only. If the pattern detection finds no concerns, the
proposal is approved. If the LLM review fails (network error, timeout),
the proposal is vetoed (fail-safe).

## Consequences

**Positive:**

- Catches novel evasion strategies that pattern detection misses.
- No single model can approve its own changes.
- Fail-safe: if the overseer can't review, it vetoes.

**Negative:**

- Adds latency (one LLM call per SICA proposal).
- The overseer LLM itself could have blind spots. Mitigation: pattern-
  based detection always runs as a first line of defense.
- False positives (vetoing safe changes) slow down SICA. This is
  intentional — false vetoes are far less costly than false approvals.

## Implementation

- `packages/core/src/memory/sica/overseer.ts` — SafetyOverseer class
  with pattern-based checks + optional LLM review
- 7 concern categories with severity levels (info/warning/critical)
- Automatic veto on any critical concern
- Fail-safe veto on LLM review failure

## References

- Constitutional AI (Anthropic) — scalable oversight pattern
- Upstream `module-5-memory-and-self-improvement.md` — overseer section
