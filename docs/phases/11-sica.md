# Phase 11 — SICA Recursive Self-Improvement (Module 5, part 4)

**Status:** Pending
**Modules touched:** M5 (SICA, immutable safety registry, LLM overseer)
**Compliance gates:** G5 (liability shield — partial; insurance + audit log)

## Goal

Build the SICA loop (evaluate → archive → self-edit → guard → re-evaluate
→ adopt/revert), the immutable safety registry, the LLM-based safety
overseer, the benchmark-overfitting detector, rate limiting, and
rollback.

## Definition of Done

- [ ] `src/memory/sica/loop.ts` — recursive self-improvement cycle
- [ ] `src/memory/sica/immutable-registry.ts` — filesystem read-only mounts
- [ ] `src/memory/sica/overseer.ts` — separate GLM-5.2 instance with veto power
- [ ] `src/memory/sica/overfit-detector.ts` — held-out eval set
- [ ] `src/memory/sica/archive.ts` — append-only version history
- [ ] `src/memory/sica/rollback.ts` — restore any prior version
- [ ] `src/memory/sica/rate-limiter.ts` — max 10 cycles/day, human review for >50 LOC
- [ ] `configs/learning.toml` — SICA config (enabled=false until guardrails in place)
- [ ] ADR-0031 (immutable safety registry is the keystone of SICA)
- [ ] ADR-0032 (RSI guardrails are pre-standard best practices)
- [ ] ADR-0033 (LLM-based safety overseer with veto power)

## Steps (P11.x)

11.1 Write `src/memory/sica/immutable-registry.ts` (filesystem read-only mounts)
11.2 Write `src/memory/sica/overseer.ts` (separate GLM-5.2 instance, veto on safety)
11.3 Write `src/memory/sica/loop.ts` (evaluate → archive → self-edit → guard → re-evaluate → adopt/revert)
11.4 Write `src/memory/sica/overfit-detector.ts`
11.5 Write `src/memory/sica/archive.ts` (append-only)
11.6 Write `src/memory/sica/rollback.ts`
11.7 Write `src/memory/sica/rate-limiter.ts`
11.8 Write `configs/learning.toml` (SICA disabled by default)
11.9 Write 50-cycle integration test for monotonic improvement
11.10 ADR-0031, ADR-0032, ADR-0033
11.11 Worklog entry for Phase 11

## Key Engineering Decisions

- **Immutable safety registry.** Protects sandbox configs, approval policy
  engine, safety hook scripts, SICA evaluation harness, benchmark scoring
  logic, and the registry itself. Filesystem read-only.
- **LLM-based overseer.** Separate GLM-5.2 instance; vetoes diffs that
  disable safety checks, hardcode benchmark answers, remove logging,
  expand sandbox boundaries, or weaken approval policies.
- **Test-gated adoption.** Full test suite must pass AND benchmark must
  improve — no sideways changes.
- **Benchmark-overfitting detection.** Separate holdout set the optimizer
  never sees; reject changes that help benchmark but hurt holdout.
- **Rate limiting.** Max 10 SICA cycles/day, human review required for
  any change >50 LOC.
- **Full audit trail.** Every proposed change, evaluation, adoption/
  reversion logged immutably; archive is append-only.
- **Rollback capability.** Any prior version restorable.
- **National-security-level risk framing.** 2026 International AI Safety
  Report flags RSI loss-of-control as among the most consequential risks.
  Guardrails must exist from day one.
