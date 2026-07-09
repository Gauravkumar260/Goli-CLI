# ADR-0033: Semantic Error Rate Tracking

**Status:** Accepted
**Phase:** P12
**Date:** 2026-07-03

## Context

~19.78% of "solved" SWE-bench cases are semantically wrong: the patch
passes tests but is functionally incorrect. An agent that scores 90%
resolution with 20% semantic error rate is actually only 72% correct —
worse than an agent that scores 80% with 5% semantic error (76% correct).

## Decision

Track **semantic error rate** alongside resolution rate. Sample 10% of
"solved" cases and use GLM-5.2 `reasoning_effort=max` to verify
semantic correctness. The corrected resolution rate (after removing
semantic errors) is the "true" resolution rate.

## References

- SWE-bench semantic error rate: ~19.78% (upstream spec)
- 10% sampling rate (statistically significant, affordable)
- Upstream `module-6-evals-and-observability.md`
