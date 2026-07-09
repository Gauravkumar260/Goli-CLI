# ADR-0031: mini-swe-agent for Leaderboard Comparability

**Status:** Accepted
**Phase:** P12
**Date:** 2026-07-03

## Context

SWE-bench Verified is the de facto north-star benchmark for coding
agents (500 instances, OpenAI Aug 2024). But leaderboard scores are
only comparable if the harness is the same. Custom harnesses can inflate
scores through harness-specific advantages (better localization, better
context management, etc.).

## Decision

Use the `mini-swe-agent` pattern (the SWE-bench team's 100-line
reference agent) for all benchmark evaluations. This ensures apples-to-
apples comparison with published leaderboards.

## References

- mini-swe-agent: SWE-bench team's reference agent (100 LOC)
- Used by Meta, NVIDIA, Princeton, Stanford
- Upstream `module-6-evals-and-observability.md`
