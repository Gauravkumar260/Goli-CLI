# ADR-0022: Tree-Sitter Over LSP for Symbol Extraction

**Status:** Accepted
**Phase:** P7
**Date:** 2026-07-03

## Context

The context engine needs to parse source files into semantic chunks
(functions, classes, methods) for the symbol graph and the semantic
retrieval layer. The two options are:

1. **LSP (Language Server Protocol)** — query a running language
   server for symbol definitions
2. **tree-sitter** — parse the AST directly

## Decision

Use **tree-sitter** for symbol extraction, not LSP.

Rationale:

1. **Deterministic.** tree-sitter produces the same AST every time.
   LSP varies across implementations and versions (tsserver vs
   typescript-language-server vs TS's own LSP).
2. **Complete.** tree-sitter parses the entire file, even if parts
   have syntax errors. LSP may refuse to return symbols for files
   with errors.
3. **Cacheable.** tree-sitter parses are pure functions of the input
   text. LSP requires a running server process with state.
4. **Multi-language.** tree-sitter has grammars for 300+ languages
   via `tree-sitter-language-pack`. LSP requires a separate server
   per language.
5. **No server process.** tree-sitter runs in-process; LSP requires
   spawning and managing server processes.
6. **Industry standard.** GitHub uses tree-sitter for code navigation
   (symbols, go-to-definition). Neovim uses it for syntax
   highlighting. Cursor uses it for code search.

## Phase 7 Implementation Note

Phase 7 ships a regex-based fallback for symbol extraction (the
`TreeSitterIndexer` class uses language-specific regex patterns
instead of native tree-sitter parsing). This is because the
`tree-sitter` npm package requires native bindings that may not be
available in all environments.

The interface is designed to swap in real tree-sitter parsing without
changing callers. A later iteration will replace the regex fallback
with `tree-sitter` + `tree-sitter-language-pack` for production use.

## Consequences

**Positive:**

- Deterministic, cacheable, multi-language.
- No server process needed.
- Works even with syntax errors.
- Industry standard.

**Negative:**

- The Phase 7 regex fallback is less accurate than real tree-sitter
  (may miss symbols with unusual formatting).
- Native tree-sitter bindings require compilation (future iteration).

## Implementation

- `packages/core/src/context/indexer/tree-sitter.ts` —
  `TreeSitterIndexer` class with content-hash dedup, incremental
  parsing, multi-language support (TS/JS/Python/Rust/Go/Java/C/C++/Ruby)
- Future: replace regex fallback with `tree-sitter` +
  `tree-sitter-language-pack` npm packages

## References

- tree-sitter: <https://tree-sitter.github.io/>
- tree-sitter-language-pack: <https://github.com/grantjenks/tree-sitter-language-pack>
- GitHub code navigation (uses tree-sitter)
- Upstream `module-2-context-engine.md` — tree-sitter section
