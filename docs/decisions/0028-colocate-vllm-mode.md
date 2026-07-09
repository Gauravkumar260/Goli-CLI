# ADR-0028: Colocate vLLM Mode for LoRA Training

**Status:** Accepted
**Phase:** P10
**Date:** 2026-07-03

## Context

During GRPO + LoRA fine-tuning, the model serves rollouts (generates
completions for the training examples). vLLM is the inference engine
used for this — it's fast and supports LoRA adapters.

Two vLLM modes are available:
- **Server mode**: vLLM runs as a separate process, communicates via
  HTTP. TRL sends generation requests to the server.
- **Colocate mode**: vLLM runs in the same process as TRL. No HTTP
  overhead; tighter GPU coupling.

## Decision

Use **colocate mode** for vLLM during training.

Rationale:
1. **LoRA adapter loading bug.** In server mode, LoRA adapters can
   silently fail to load — the server serves the base model without
   the adapter applied. This is a known vLLM bug. Colocate mode avoids
   it by sharing the process memory space.
2. **Lower latency.** No HTTP overhead between TRL and vLLM. During
   training with 30 rollouts per task, this saves significant time.
3. **Simpler setup.** No separate vLLM server process to manage.

## Consequences

**Positive:**
- Avoids the LoRA adapter loading bug.
- Lower latency (no HTTP).
- Simpler setup (one process).

**Negative:**
- Tighter GPU coupling — if vLLM crashes, TRL crashes too.
- Less flexible — can't swap vLLM versions independently of TRL.
- Memory sharing — vLLM and TRL share the process memory space, which
  can cause OOM if both are memory-hungry.

## Implementation

- `packages/core/src/memory/training/grpo-scaffold.ts` — the generated
  Python script sets `vllm_mode="colocate"` in the `GRPOConfig`

## References

- vLLM colocate mode: <https://docs.vllm.ai/en/latest/training.html>
- TRL GRPO with vLLM: <https://huggingface.co/docs/trl/main/en/grpo_trainer>
- Known LoRA + vLLM-server bug (adapter weights not loaded)
