# ADR-0032: Self-Hosted Langfuse Over LangSmith SaaS

**Status:** Accepted
**Phase:** P12
**Date:** 2026-07-03

## Context

GOLI-CLI needs an observability backend for OpenTelemetry traces. The
two main options:

- **Langfuse** (MIT, self-hostable): PostgreSQL + ClickHouse backend,
  Docker Compose deploy, full control over data.
- **LangSmith** (proprietary SaaS): LangChain's hosted offering, no
  self-hosting, data egress to LangChain's servers.

## Decision

Use **self-hosted Langfuse** (not LangSmith).

Rationale:

1. **Zero data egress.** The entire GOLI-CLI legal posture is built on
   zero data egress (GDPR, EU AI Act, enterprise customer DPAs). Sending
   traces to LangSmith's SaaS would violate this.
2. **MIT licensed.** No vendor lock-in; full source code available.
3. **OpenTelemetry-compatible.** Langfuse accepts OTLP/HTTP exports.
4. **Docker Compose deploy.** Easy to self-host; PostgreSQL + ClickHouse
   are standard infrastructure.

## References

- Langfuse: <https://github.com/langfuse/langfuse> (MIT)
- LangSmith: proprietary SaaS (rejected)
- Upstream `module-6-evals-and-observability.md`
