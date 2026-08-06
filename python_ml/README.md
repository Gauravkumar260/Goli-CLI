# GOLI-CLI Python ML/RL Pipeline (Module 5)

This directory contains the Python implementation of the GRPO
(Group Relative Policy Optimization) fine-tuning pipeline for
open-weight models (e.g. `gpt-oss:120b`, GLM-5.2, DeepSeek V4,
Qwen3-Coder, Kimi K2.7-Code).

The TypeScript side (`packages/memory-engine/src/training/grpo-scaffold.ts`)
generates the dataset and emits training configs. This directory contains
the actual training loop that consumes those artifacts and produces
LoRA adapters via TRL + vLLM.

## Quick Start

```bash
# 1. Install dependencies (Python 3.10+ required)
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Build the training dataset from trajectory JSONL
#    Trajectories are emitted by packages/memory-engine/src/trajectory/store.ts
#    to ~/.goli-cli/trajectories/trajectories.jsonl (+ SQLite index at index.db)
python build_dataset.py \
  --trajectories ~/.goli-cli/trajectories/trajectories.jsonl \
  --output datasets/goli-train.jsonl \
  --min-reward 0.6

# 3. Run GRPO fine-tuning with vLLM co-location
#    Default base model: gpt-oss:120b (open-weight); --model can point at
#    any open-weight HuggingFace checkpoint (e.g. glm-5.2, deepseek-v3)
python train_grpo.py \
  --model gpt-oss:120b \
  --dataset datasets/goli-train.jsonl \
  --output adapters/goli-gpt-oss-lora \
  --vllm-mode colocate \
  --gpu-memory-utilization 0.9 \
  --iterations 2  # SWE-Gym research shows diminishing returns after 2

# 4. Evaluate the fine-tuned adapter
#    swe-bench-verified-50 is the 50-instance CI subset; the full
#    swe-bench-verified benchmark is used for release gating.
python evaluate.py \
  --base-model gpt-oss:120b \
  --adapter adapters/goli-gpt-oss-lora \
  --benchmark swe-bench-verified-50
```

## Files

| File                 | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `train_grpo.py`      | TRL + vLLM training loop (GRPO with co-located inference) |
| `reward_function.py` | Test-pass + efficiency + safety penalty rewards           |
| `build_dataset.py`   | Read trajectory JSONL, filter by reward, format for TRL   |
| `evaluate.py`        | Run SWE-bench against a base or fine-tuned model          |
| `requirements.txt`   | Pinned Python dependencies (TRL ≥ 0.12, vLLM, torch)      |
| `tests/`             | Pytest unit tests for reward function and dataset builder |

## Reward Function Design

The reward is a weighted sum of:

| Component                   | Weight | Rationale                                               |
| --------------------------- | ------ | ------------------------------------------------------- |
| `tests_pass`                | 1.0    | Did the agent's patch make the tests pass?              |
| `efficiency_bonus`          | 0.3    | Lower token count = higher reward (penalize verbosity)  |
| `safety_penalty`            | -1.0   | Hook violations, secret reads, destructive commands     |
| `semantic_bonus`            | 0.2    | Semantic-check evaluator passed (no test-gaming)        |
| `trajectory_length_penalty` | -0.1   | Penalize meandering trajectories (encourage directness) |

The reward is normalized per-rollout-group (GRPO characteristic advantage)
so the model learns _relative_ quality, not absolute. The TS-side reward
function (`packages/memory-engine/src/training/reward.ts`) defines the
canonical components; this Python module mirrors the math for the TRL
training loop.

## Why GRPO over PPO?

See `docs/decisions/0027-grpo-over-ppo.md`. Short version:

- No value network → 40% less GPU memory
- Group-relative advantage → more stable updates
- Better for code-generation tasks where reward variance is high
- Proven for GLM family + Qwen3-Coder + Kimi K2.7-Code

## vLLM Co-location

`vllm_mode="colocate"` runs the policy inference inside the training
process, avoiding GPU-to-GPU network overhead AND avoiding the LoRA
adapter loading bug in vLLM server mode (see ADR-0028). Requires
TRL ≥ 0.12 and vLLM ≥ 0.6. Set `--gpu-memory-utilization 0.9` to leave
headroom for the training optimizer states.

**Hardware requirement:** 8× H100 / H200 GPUs externally (the
`packages/core` code only generates the training script — it does not
execute it). See `infra/README.md` for self-hosted vLLM deployment.

## Safety: SICA Integration

The SICA loop (`packages/memory-engine/src/sica/`) gates which proposals
are adopted. A proposal that improves SWE-bench but degrades the
holdout set is rejected by the `OverfitDetector`. A proposal that the
LLM safety overseer (`SafetyOverseer`) flags is vetoed. A proposal
that exceeds 10 cycles/day or 50 LOC of changes is rate-limited
(`SicaRateLimiter`). Only proposals that pass ALL gates are applied
to the live agent — the fine-tuned adapter is a _separate_ artifact
that must clear its own eval gate before deployment.

See `docs/decisions/0029-immutable-safety-registry.md` and
`docs/decisions/0030-llm-safety-overseer.md` for the full safety model.

## Legal: Open-Weight Only

This pipeline ONLY trains open-weight models (`gpt-oss:120b`, GLM-5.2,
DeepSeek V4, Qwen3-Coder, Kimi K2.7-Code). Training closed-weight
models (GPT-4, Claude, Gemini) via their APIs violates their ToS and
is blocked at the dataset level (`build_dataset.py` refuses
trajectories from `BLOCKED_PROVIDERS`). See
`docs/decisions/0034-open-weight-only-routing.md` for the routing
policy and `legal/TERMS_OF_SERVICE.md` §4 for the user-liability
terms.
