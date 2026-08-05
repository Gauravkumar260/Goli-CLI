# ADR-0045: LSP Integration (H21)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H21 — LSP Integration
**Extends:** ADR-0022 (tree-sitter over LSP) — partially. ADR-0022
chose tree-sitter for the context engine (static analysis). This ADR
adds LSP as a _complementary_ tool for interactive queries.

## Context

ADR-0022 chose tree-sitter over LSP for the context engine, citing
determinism, no external server dependency, and faster startup. This
was correct for the indexer use case (build a symbol graph once,
query it many times).

However, tree-sitter cannot provide:

- **Live diagnostics** (errors/warnings as the user types)
- **Hover documentation** (type signatures, JSDoc)
- **Goto-definition** (jump to where a symbol is defined)
- **Find references** (all usages of a symbol across the workspace)

These require a running language server that tracks file changes and
project state. OpenCode and Cursor both use LSP for these features;
GOLI-CLI lacked them entirely.

## Decision

Add **four LSP tools** that wrap a language server client:

### Tools

1. **`lsp_hover`** — get hover docs for a symbol at a position
2. **`lsp_goto_definition`** — find where a symbol is defined
3. **`lsp_references`** — find all references to a symbol
4. **`lsp_diagnostics`** — get errors/warnings for a file

All four are T0 (read-only — LSP queries don't modify state).

### LSP client interface

The tools delegate to `ctx.lspClient`, which the agent loop provides.
The `LspClient` interface has four methods: `hover`, `gotoDefinition`,
`references`, `diagnostics`. The actual implementation (spawning
language servers, JSON-RPC over stdio) is provided by the caller —
the tool layer is decoupled.

When no client is set, the tools throw with a helpful message (mirrors
the `spawn_subagent` pattern from H15).

### Coordinate convention

The model sees 1-based line numbers in `read_file` output (human-
readable). The tools convert to 0-based internally (LSP convention)
before calling the client. This keeps the model's view consistent
with what it sees in file output.

### Coexistence with tree-sitter

Tree-sitter remains the context engine's indexer (ADR-0022 unchanged).
LSP is an _additional_ tool for interactive queries — the two do not
conflict. Tree-sitter builds the symbol graph for retrieval; LSP
answers ad-hoc queries the model makes during a task.

## Consequences

**Positive:**

- The model can now get live diagnostics, hover docs, and goto-definition.
- Closes a competitive gap with OpenCode and Cursor.
- The `LspClient` interface is mockable — tests don't need real servers.
- Composes with tree-sitter (no conflict).
- Backward-compatible: when no client is set, the tools are inert.

**Negative:**

- Requires a running language server (typescript-language-server,
  gopls, rust-analyzer, pyright, etc.). The agent loop must spawn
  and manage these. Follow-up.
- LSP servers have startup latency (~1-3s). Mitigation: spawn lazily
  on first LSP tool call.
- LSP varies across implementations (ADR-0022's rationale). Mitigation:
  the `LspClient` interface is minimal; per-language quirks are hidden
  behind it.
- Adds 4 tools (count 17 → 21). Accepted.

## Alternatives Considered

### A. Replace tree-sitter with LSP entirely

Rejected: ADR-0022's rationale (determinism, no server dependency,
faster startup) still holds for the indexer. LSP is complementary,
not a replacement.

### B. Use the TypeScript Compiler API directly (no LSP)

Rejected: only works for TypeScript. LSP supports 20+ languages.

### C. Skip LSP, extend tree-sitter

Rejected: tree-sitter is a parser, not a type checker. It cannot
provide hover docs, diagnostics, or goto-definition. These require
semantic analysis that only a language server can do.

## Implementation

- `packages/core/src/tools/core/lsp-types.ts` — `LspClient`,
  `LspLocation`, `LspHoverResult`, `LspDiagnostic`, `LspSeverity`,
  `formatLocation`, `formatDiagnostic`
- `packages/core/src/tools/core/lsp-tools.ts` — `LSP_HOVER_TOOL`,
  `LSP_GOTO_DEFINITION_TOOL`, `LSP_REFERENCES_TOOL`,
  `LSP_DIAGNOSTICS_TOOL`, `LSP_TOOLS`
- `packages/core/src/tools/types.ts` — `ToolContext.lspClient`
- `packages/core/src/tools/index.ts` — register 4 new tools (count 17 → 21)
- `tests/unit/lsp-integration.test.ts` — 14 unit tests with a mock client
- `tests/unit/tool-registry.test.ts` — updated count 17 → 21

## Follow-up

- Implement a concrete `LspClient` that spawns language servers
  (typescript-language-server, gopls, rust-analyzer, pyright) and
  communicates via JSON-RPC over stdio.
- Wire `lspClient` into `AgentLoop` (lazily spawned on first LSP tool
  call).
- Detect the workspace's language(s) and spawn the appropriate server(s).
- Cache LSP responses within a single tool-call batch (the model often
  calls `lsp_hover` + `lsp_references` on the same symbol).
- Add `lsp_rename` and `lsp_code_actions` tools (future).
