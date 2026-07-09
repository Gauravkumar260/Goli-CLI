# ADR-0027: GRPO Over PPO for Fine-Tuning

**Status:** Accepted
**Phase:** P10
**Date:** 2026-07-03

## Context

GOLI-CLI fine-tunes GLM-5.2 on successful task trajectories to improve
the agent's coding ability. The two main RL algorithms are:

- **PPO (Proximal Policy Optimization)**: the standard RL algorithm,
  but requires a separate value model (critic) alongside the policy
  model.
- **GRPO (Group Relative Policy Optimization)**: eliminates the critic
  by computing rewards relative to a group of rollouts.

## Decision

Use **GRPO** (not PPO) for fine-tuning GLM-5.2.

Rationale:
1. **No critic model.** PPO's value model would double memory/compute
   at GLM-5.2's 744B scale. On 8×H100 (640GB VRAM), fitting both the
   744B policy + a 744B critic in FP8 is tight. GRPO only needs the
   policy.
2. **Proven for GLM family.** GRPO has been shown to work well with
   GLM models. The Z.ai team uses GRPO for GLM-5.2's own RL training.
3. **Simpler implementation.** No value function to train; reward is
   computed directly from the group of rollouts.
4. **Better for coding tasks.** Coding tasks have binary rewards (tests
   pass or fail) — GRPO's group-relative scoring handles this well.

## Consequences

**Positive:**
- Halves the VRAM requirement (no critic).
- Simpler training pipeline.
- Proven for the GLM model family.

**Negative:**
- GRPO requires more rollouts per task (default: 30) to compute stable
  group statistics. This increases inference cost during training.
- Less mature than PPO in some RL libraries. Mitigation: TRL (Transformers
  Reinforcement Learning) has production GRPO support.

## Implementation

- `packages/core/src/memory/training/grpo-scaffold.ts` — generates the
  Python training script with `GRPOConfig` + `GRPOTrainer` from TRL
- `packages/core/src/memory/training/reward.ts` — reward function
  (tests pass + efficiency + safety penalty)
- `packages/core/src/memory/trajectory/curator.ts` — rejection sampling
  to build the training dataset

## References

- GRPO: DeepSeekMath paper (Shao et al., 2024)
- TRL (Transformers Reinforcement Learning): <https://github.com/huggingface/trl>
- SWE-Gym: 2-iteration rejection sampling fine-tuning (up to 19% absolute gains)
- Upstream `module-5-memory-and-self-improvement.md` — fine-tuning section
