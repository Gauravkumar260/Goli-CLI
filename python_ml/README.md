# GOLI-CLI Python ML/RL Pipeline (Module 5)

This directory contains the Python implementation of the GRPO
(Group Relative Policy Optimization) fine-tuning pipeline for GLM-5.2.

The TypeScript side (`packages/core/src/memory/training/grpo-scaffold.ts`)
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
python build_dataset.py \
  --trajectories ~/.goli-cli/trajectories.jsonl \
  --output datasets/goli-train.jsonl \
  --min-reward 0.6

# 3. Run GRPO fine-tuning with vLLM co-location
python train_grpo.py \
  --model glm-5.2 \
  --dataset datasets/goli-train.jsonl \
  --output adapters/goli-glm-5.2-lora \
  --vllm-mode colocate \
  --gpu-memory-utilization 0.9

# 4. Evaluate the fine-tuned adapter
python evaluate.py \
  --base-model glm-5.2 \
  --adapter adapters/goli-glm-5.2-lora \
  --benchmark swe-bench-verified-50
```

## Files

| File | Purpose |
|------|---------|
| `train_grpo.py` | TRL + vLLM training loop (GRPO with co-located inference) |
| `reward_function.py` | Test-pass + efficiency + safety penalty rewards |
| `build_dataset.py` | Read trajectory JSONL, filter by reward, format for TRL |
| `evaluate.py` | Run SWE-bench against a base or fine-tuned model |
| `requirements.txt` | Pinned Python dependencies (TRL ≥ 0.12, vLLM, torch) |
| `tests/` | Pytest unit tests for reward function and dataset builder |

## Reward Function Design

The reward is a weighted sum of:

| Component | Weight | Rationale |
|-----------|--------|-----------|
| `tests_pass` | 1.0 | Did the agent's patch make the tests pass? |
| `efficiency_bonus` | 0.3 | Lower token count = higher reward (penalize verbosity) |
| `safety_penalty` | -1.0 | Hook violations, secret reads, destructive commands |
| `semantic_bonus` | 0.2 | Semantic-check evaluator passed (no test-gaming) |
| `trajectory_length_penalty` | -0.1 | Penalize meandering trajectories (encourage directness) |

The reward is normalized per-rollout-group (GRPO characteristic advantage)
so the model learns *relative* quality, not absolute.

## Why GRPO over PPO?

See `docs/decisions/0027-grpo-over-ppo.md`. Short version:
- No value network → 40% less GPU memory
- Group-relative advantage → more stable updates
- Better for code-generation tasks where reward variance is high

## vLLM Co-location

`vllm_mode="colocate"` runs the policy inference inside the training
process, avoiding GPU-to-GPU network overhead. Requires TRL ≥ 0.12 and
vLLM ≥ 0.6. Set `--gpu-memory-utilization 0.9` to leave headroom for
the training optimizer states.

## Safety: SICA Integration

The SICA loop (`packages/core/src/memory/sica/`) gates which proposals
are adopted. A proposal that improves SWE-bench but degrades the
holdout set is rejected (overfitting). A proposal that the LLM safety
overseer flags is vetoed. Only proposals that pass both gates are
applied to the live agent — the fine-tuned adapter is a *separate*
artifact that must clear its own eval gate before deployment.

## Legal: Open-Weight Only

This pipeline ONLY trains open-weight models (GLM-5.2, DeepSeek, Qwen,
Kimi). Training closed-weight models (GPT-4, Claude) via their APIs
violates their ToS and is blocked at the dataset level
(`build_dataset.py` refuses trajectories from blocked providers).
