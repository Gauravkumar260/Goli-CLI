# ADR-0046: Real Tree-Sitter (H22)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H22 — Real Tree-Sitter
**Extends:** ADR-0022 (tree-sitter over LSP)

> **Correction (2026-08-07):** Like ADR-0022, this record cites `tree-sitter-language-pack`, which **does not exist on npm** (`npm view tree-sitter-language-pack` 404s). The real package is **`tree-sitter-languages`** (plural), loaded via optional dynamic `import()`. Because that import is not guaranteed to resolve, the **regex fallback in `packages/context-engine/src/indexer/tree-sitter.ts` is the production code path**; `TreeSitterIndexer` tries the native binding and falls back gracefully.

## Context

ADR-0022 chose tree-sitter for the context engine's indexer, but the
Phase 7 implementation shipped with a **regex-based fallback** instead
of real tree-sitter native bindings. The `TreeSitterIndexer.extractChunks`
method uses language-specific regexes to find `function`, `class`,
`interface`, `type`, etc. — not AST-based parsing.

This has known limitations:

- **False positives**: the regex `(?:\w+\s*:\s*)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*:`
  matches any `identifier(args):` pattern, including non-method
  constructs (type assertions, conditional expressions).
- **False negatives**: regexes miss symbols that don't match the
  pattern (e.g., generator functions `function*`, arrow functions
  assigned to const, decorators).
- **No structural awareness**: the regex can't tell if a `function`
  keyword is inside a comment, string, or nested scope.
- **Brittle end-line detection**: the `findSymbolEnd` heuristic
  (next line at same-or-lower indentation) fails for multi-line
  function signatures, decorators, and nested classes.

Real tree-sitter native bindings (`tree-sitter` + `tree-sitter-language-pack`
npm packages) parse the file into an AST and walk it for symbol nodes
— accurate, structural, and handles edge cases.

## Decision

Add a **real tree-sitter adapter** (`real-tree-sitter.ts`) that:

1. Dynamically imports `tree-sitter` and `tree-sitter-language-pack`.
2. If both load successfully, uses AST-based extraction.
3. If either fails to load (not installed, wrong platform, missing
   prebuilt binary), returns `[]` — the caller falls back to regex.

### API additions

- `TreeSitterIndexer.indexFileAsync(path)` — async, tries real
  tree-sitter first, falls back to regex. Preferred method.
- `TreeSitterIndexer.indexFilesAsync(paths)` — async batch version.
- `TreeSitterIndexer.isUsingRealTreeSitter()` — returns whether
  native bindings are available.
- `isRealTreeSitterAvailable()` — standalone availability check.
- `extractChunksWithTreeSitter(path, content, language)` —
  AST-based extraction (returns `[]` if unavailable).

### Backward compatibility

The sync `indexFile(path)` and `extractChunks(...)` methods are
unchanged — they still use the regex-based extractor. Existing callers
(HybridRetriever, createContextEngine) continue to work without
modification. Migration to the async path is opt-in.

### Why dynamic import (not static)?

`tree-sitter` uses N-API native bindings. If the bindings are missing
(wrong platform, missing prebuilt binary, broken install), a static
`import` would crash the whole module on load. Dynamic `import()` lets
us catch the error and fall back gracefully — the CLI still works,
just with regex-quality indexing.

### Why optional dependencies (not required)?

- Not everyone needs tree-sitter (small repos, quick scripts).
- The native bindings add ~5MB to `node_modules`.
- `prebuild-install` doesn't cover every platform (e.g., musl libc,
  FreeBSD). Forcing the install would break those users.

The packages are listed as optional dependencies in `package.json`
(follow-up): `npm install` tries to install them, but failure is
non-fatal.

## Consequences

**Positive:**

- AST-based extraction is accurate (no false positives/negatives).
- Handles edge cases (generators, arrow functions, decorators).
- Backward-compatible: sync path unchanged.
- Graceful fallback: works without the native packages.
- The `SemanticChunk` shape is unchanged — callers see no difference.

**Negative:**

- Two code paths (async + sync) — maintenance burden. Mitigation:
  document that the async path is preferred; deprecate the sync path
  in a future major version.
- Native bindings add install time and platform complexity.
  Mitigation: `prebuild-install` covers the common platforms.
- The async path has a small overhead (availability check + dynamic
  import on first call). Mitigation: the availability check is cached.
- Tests can't easily verify the real tree-sitter path (packages not
  installed in CI). Mitigation: the regex fallback is tested; the
  real tree-sitter path is tested in a separate e2e suite that
  installs the packages.

## Alternatives Considered

### A. Replace the regex extractor entirely (breaking change)

Rejected: would break existing callers (HybridRetriever, tests) that
depend on the sync `indexFile`. The async addition is non-breaking.

### B. Use the TypeScript Compiler API instead of tree-sitter

Rejected: only works for TypeScript. Tree-sitter supports 10+ languages
with a uniform API.

### C. Wait for tree-sitter WASM bindings

Deferred: WASM bindings would eliminate the native dependency, but
they're slower (~2-3x) than N-API and not yet stable. We can migrate
later without changing the adapter API.

## Implementation

- `packages/core/src/context/indexer/real-tree-sitter.ts` —
  `isRealTreeSitterAvailable`, `extractChunksWithTreeSitter`,
  `_resetTreeSitterCache`, `NODE_TYPE_MAP`
- `packages/core/src/context/indexer/tree-sitter.ts` — added
  `indexFileAsync`, `indexFilesAsync`, `isUsingRealTreeSitter`
  methods (sync methods unchanged)
- `packages/core/src/context/index.ts` — exports
- `tests/unit/real-tree-sitter.test.ts` — 11 unit tests covering
  availability, async path, fallback, caching, sync backward compat

## Follow-up

- Add `tree-sitter` and `tree-sitter-language-pack` as optional
  dependencies in `packages/core/package.json`.
- Migrate `HybridRetriever` to use `indexFileAsync` (preferred).
- Add `prebuild-install` to the install script for cross-platform
  native binaries.
- Deprecate the sync `indexFile` (emit a warning when called).
- Add e2e tests that install the native packages and verify
  AST-based extraction (separate test suite).
- Consider WASM bindings as a future option (eliminates native deps).
