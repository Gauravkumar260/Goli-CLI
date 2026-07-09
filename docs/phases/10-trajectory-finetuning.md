# Phase 10 — Trajectory Logging & Fine-Tuning (Module 5, part 3)

**Status:** Pending
**Modules touched:** M5 (trajectory logging, GRPO + LoRA pipeline)
**Compliance gates:** none new

## Goal

Build the structured JSONL trajectory logging pipeline, the rejection-
sampling curator, and the GRPO + LoRA fine-tuning pipeline scaffold
(TRL + vLLM, colocate mode). Reward function: tests pass + efficiency
bonus + safety penalty.

## Definition of Done

- [ ] `src/memory/trajectory/store.ts` — JSONL + SQLite index in `~/.agent/trajectories/`
- [ ] `src/memory/trajectory/schema.ts` — `Trajectory` type (task, steps, outcome, tokens, cost, duration)
- [ ] `src/memory/trajectory/curator.ts` — rejection sampling (30 high-temp rollouts/task, keep successes, 2 iterations max)
- [ ] `src/memory/training/grpo-train.py` — TRL + vLLM colocate scaffold
- [ ] `src/memory/training/reward.ts` — reward function (tests + efficiency + safety penalty)
- [ ] `src/memory/training/dataset-builder.ts` — builds training set from curated trajectories
- [ ] `src/memory/training/holdout.ts` — SWE-bench Verified holdout separation
- [ ] `src/memory/training/eval-holdout.ts` — eval against holdout (never trained on)
- [ ] ADR-0028 (GRPO over PPO for fine-tuning)
- [ ] ADR-0029 (colocate vLLM mode avoids LoRA adapter bug)
- [ ] ADR-0030 (2-iteration cap on RFT)

## Steps (P10.x)

10.1 Write `src/memory/trajectory/store.ts` + `schema.ts`
10.2 Wire trajectory logging into AgentLoop (Phase 2) — every step logged
10.3 Write `src/memory/trajectory/curator.ts` (rejection sampling)
10.4 Write `src/memory/training/dataset-builder.ts`
10.5 Write `src/memory/training/reward.ts`
10.6 Write `src/memory/training/grpo-train.py` (Python scaffold; TRL + vLLM)
10.7 Write `src/memory/training/{holdout,eval-holdout}.ts`
10.8 Write tests: trajectory store round-trip, curator rejection sampling, reward function
10.9 ADR-0028, ADR-0029, ADR-0030
10.10 Worklog entry for Phase 10

## Key Engineering Decisions

- **GRPO over PPO.** Eliminates the critic (which would double memory/compute
  at GLM-5.2's 744B scale); proven for the GLM model family.
- **Colocate vLLM mode.** Avoids the LoRA+vLLM-server bug where adapter
  weights silently fail to load. Tradeoff: tighter GPU coupling.
- **2-iteration cap on RFT.** Diminishing returns after SWE-Gym's
  documented 2 iterations.
- **Reward function.** Tests pass (primary, 0/1) + efficiency bonus (fewer
  tokens) + safety penalty (hook violations).
- **Training/eval contamination strict.** SWE-Gym for training, SWE-bench
  Verified for evaluation only.
