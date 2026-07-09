# ADR-0034: Open-Weight-Only Routing — Hard-Blocked Providers

**Status:** Accepted
**Phase:** P13
**Date:** 2026-07-03

## Context

Anthropic's ToS bars using their APIs to build competing products.
This was enforced against OpenAI (Aug 2025) and xAI/Cursor (Jan 2026).
Routing to closed-weight providers in a distributed agent is a ToS
violation.

## Decision

GOLI-CLI hard-blocks `['anthropic', 'openai']` providers in the routing
config. Only open-weight models (GLM-5.2, DeepSeek V4, Qwen3-Coder,
Kimi K2.7-Code) are allowed.

## Implementation

- `packages/core/src/orchestration/routing/classifier.ts` —
  `BLOCKED_PROVIDERS` constant + `isProviderAllowed()` check
- The SwarmPipeline verifies the routing decision before execution

## References

- Anthropic ToS (competing-product clause)
- OpenAI ToS enforcement (Aug 2025)
- xAI/Cursor enforcement (Jan 2026)
