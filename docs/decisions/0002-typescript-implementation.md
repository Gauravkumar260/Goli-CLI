# ADR-0002: TypeScript as Implementation Language

**Status:** Accepted
**Phase:** P1
**Date:** 2026-07-03

## Context

The upstream GOLI-CLI roadmap names three viable implementation
languages: Rust (fork `codex-rs`, Apache-2.0), TypeScript (fork OpenCode,
MIT), or Go+TS (OpenCode's split). Each has tradeoffs:

| Axis                        | Rust          | TypeScript     | Go + TS    |
| --------------------------- | ------------- | -------------- | ---------- |
| Performance envelope        | Best          | Good           | Good       |
| Sandbox code safety         | Best (memory) | Good           | Good       |
| MCP SDK maturity            | Stable        | Production     | Stable     |
| Tree-sitter bindings        | Mature        | Mature         | Mature     |
| Ink/TUI story               | ratatui       | Ink + React    | Bubble Tea |
| Reference TUI in spec       | —             | ✅ Ink + React | —          |
| Ecosystem reach (npm)       | Smaller       | Largest        | Medium     |
| AI-assisted generation rate | 80-90%        | 85-90%         | 85-90%     |
| Learning curve              | Steeper       | Gentle         | Gentle     |

## Decision

Implement GOLI-CLI in **TypeScript** (Node.js 20+, ESM, strict mode).

Rationale:

1. The upstream spec ships a **TypeScript reference TUI** (Ink + React,
   33 files) that we want to port 1:1. Choosing anything else would
   require a costly port that risks introducing visual / behavioral
   regressions.
2. The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) is production-
   ready and is the most-used MCP SDK in the ecosystem.
3. npm has the largest ecosystem for the tools we need (zod, vitest,
   tsup, ink, react, tree-sitter, langfuse SDK, etc.).
4. The performance envelope is sufficient for a CLI agent — the
   bottleneck is GLM-5.2 latency (seconds), not Node overhead (ms).
5. AI-assisted generation rates are equivalent across the three
   candidates; TypeScript's familiarity advantage is the tiebreaker.

## Consequences

**Positive:**

- Direct port of the TUI reference design.
- Access to the npm ecosystem (largest of the three).
- Familiar to the widest contributor pool.
- Easy CI: just `npm install` + `npm test` + `npm run build`.

**Negative:**

- Native sandbox code (Seatbelt/Landlock) requires either a Rust
  native addon (via `napi-rs`) or shelling out to `sandbox-exec` /
  `bubblewrap`. We chose the latter (shell out) for Phase 5 — it's
  simpler and avoids a native build step. If we hit performance or
  capability ceilings, we can add a `napi-rs` addon later.
- Memory safety is weaker than Rust for the sandbox code path. Mitigation:
  every line of `src/sandbox/` requires two human reviewers (see
  `SECURITY.md`).
- No `process.exit` from deep in the call graph — Node's async model
  makes graceful shutdown tricky. The `gracefulExit` lib (Phase 3)
  handles this.

## Alternatives Considered

- **Rust (fork codex-rs)** — would give us best-in-class sandbox code
  safety, but we'd lose the reference TUI port and shrink the
  contributor pool. Revisit if we hit perf ceilings in Phase 5/13.
- **Go + TS (OpenCode pattern)** — Go for the core, TS for the TUI.
  Adds a language boundary and a build step. Not worth the complexity
  for a single-process CLI.

## References

- Upstream `enterprise-ai-coding-agent-roadmap.md` — section "What GLM-5.2 Can and Cannot Build"
- Upstream `module-1-agent-core-loop.md` — language comparison
- TUI reference design in `tui for reference design/` — TypeScript + Ink + React
