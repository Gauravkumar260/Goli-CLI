# ADR-001: Use LanceDB over pgvector

**Status:** Accepted
**Date:** 2026-05-30
**Context:** Need a vector store that works locally without Postgres. Senior and staff engineers building on large codebases need a tool that is easy to install and doesn't require complex infrastructure.
**Decision:** LanceDB — embedded, Apache 2.0, 8–10ms warm latency.
**Consequences:** No Postgres dependency. Limits future multi-user server deployment (pgvector is better there). Acceptable for V1. Easy distribution as an open-core CLI tool.
