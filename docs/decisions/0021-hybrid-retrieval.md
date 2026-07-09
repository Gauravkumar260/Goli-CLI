# ADR-0021: Hybrid Retrieval Over Pure Vector RAG

**Status:** Accepted
**Phase:** P7
**Date:** 2026-07-03

## Context

The context engine needs to answer questions like "where is X defined?",
"who calls Y?", and "find all uses of Z". The traditional RAG approach
(pure vector embeddings + similarity search) doesn't work well for code
because:

1. **Code is structural, not textual.** Vector embeddings flatten
   import graphs, call hierarchies, and module boundaries.
2. **Exact match matters.** A function named `getUser` is not similar
   to `getUserById` — they're distinct symbols.
3. **The industry moved away from pure vector RAG.** Claude Code
   removed vector search in May 2025, replacing it with grep —
   "outperformed everything. By a lot." Cursor, Windsurf, and others
   followed.

## Decision

GOLI-CLI uses **hybrid retrieval** with three strategies:

1. **Structural** — query the SQLite-backed symbol graph for
   definitions, callers, callees, and imports. Answers "where is X
   defined?", "who calls Y?", "what does Z import?".

2. **Lexical** — ripgrep for exact text matches. Answers "find all
   uses of X", "files containing Y". Respects `.gitignore`.

3. **Semantic** — vector similarity search (Phase 7 stub: docstring
   matching; full LanceDB integration in a later iteration). Used
   only for documentation queries ("how does X work?", "explain Y").

The hybrid retriever classifies each query into one of the three
strategies (or `hybrid` = all three), dispatches to the appropriate
backend, and merges results via **reciprocal rank fusion (RRF)**.

## Consequences

**Positive:**
- Structural queries are exact (no false positives from vector
  similarity).
- Lexical queries leverage ripgrep's speed and .gitignore awareness.
- Semantic queries are available for documentation/explanation
  requests without polluting code search results.
- RRF merges results from multiple strategies fairly.

**Negative:**
- Three retrieval backends to maintain (symbol graph, ripgrep, vector
  store).
- Query classification is heuristic — may misclassify edge cases.
- The semantic layer is a stub (docstring matching) until LanceDB is
  integrated.

## Implementation

- `packages/core/src/context/retriever/hybrid.ts` — HybridRetriever
  with `classifyQuery()`, `retrieveStructural()`, `retrieveLexical()`,
  `retrieveSemantic()`, `fuseResults()` (RRF with k=60)
- `packages/core/src/context/symbol-graph/sqlite.ts` — SQLite symbol
  graph (structural backend)
- `packages/core/src/context/indexer/tree-sitter.ts` — tree-sitter
  indexer (semantic backend — chunk extraction)

## References

- Anthropic blog: Claude Code removed vector search (May 2025)
- Upstream `module-2-context-engine.md` — hybrid retrieval section
- Reciprocal Rank Fusion: Cormack et al., 2009
