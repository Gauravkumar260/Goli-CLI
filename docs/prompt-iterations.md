# Goli-CLI Prompt Optimization Iterations

This log tracks every systematic change to the agent's system prompt or planning instructions. We use A/B testing on the `train` split of the golden set to validate improvements.

| Date | Hypothesis | Baseline pass@1 | Challenger pass@1 | Delta | Result | Safety impact |
|---|---|---|---|---|---|---|
| 2026-06-01 | **Baseline**: Initial Phase 6 instructions. | 93.0% (P@5) | - | - | ACCEPTED | - |
| 2026-06-01 | **Symbol Chasing**: Force `search_code` on unknown symbols. | 93.0% (P@5) | 93.0% | 0.0% | PENDING | None |
