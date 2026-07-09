# Phase 7 — Context Engine (Module 2)

**Status:** Pending
**Modules touched:** M2 (tree-sitter, symbol graph, hybrid retriever, vector store, compaction, subagent isolation)
**Compliance gates:** G4 (authorship ledger live)

## Goal

Build the tree-sitter AST indexer, the SQLite-backed symbol graph, the
hybrid retrieval router (structural + lexical + semantic), the LanceDB
vector store (Jina code embeddings), the compaction engine (70% trigger,
GLM-summarized, 5 recent files), and subagent context isolation with
enforced return budgets. End of Phase 7: the agent can answer "where is
X defined?" and "who calls Y?" via the symbol graph, and compacts at
700K tokens.

## Definition of Done

- [ ] `src/context/indexer/tree-sitter.ts` — incremental AST indexing + content-hash dedup
- [ ] `src/context/indexer/semantic-chunks.ts` — function/class/method extraction
- [ ] `src/context/symbol-graph/sqlite.ts` — directed graph (calls, imports, definitions)
- [ ] `src/context/symbol-graph/queries.ts` — `findCallers`, `findCallees`, `findImports`
- [ ] `src/context/retriever/hybrid.ts` — query classifier + dispatch (4 strategies)
- [ ] `src/context/retriever/rank-fusion.ts` — reciprocal rank fusion merge
- [ ] `src/context/vector-store/lancedb.ts` — LanceDB + Jina code embeddings
- [ ] `src/context/compaction/engine.ts` — 70% trigger + GLM summarization + 5 recent files
- [ ] `src/context/compaction/prompt.ts` — COMPACTION_PROMPT
- [ ] `src/context/subagent/isolation.ts` — return-budget enforcement (default 1000 tokens)
- [ ] `src/context/subagent/spawn.ts` — `spawn_subagent` tool (research/implementation/review types)
- [ ] `src/context/subagent/configs.ts` — SUBAGENT_CONFIGS map (type → system prompt + allowed tools)
- [ ] `src/memory/trajectory/authorship-ledger.ts` — links commits to human review actions (G4)
- [ ] ADR-0021 (hybrid retrieval over pure vector RAG)
- [ ] ADR-0022 (tree-sitter over LSP for symbol graph)
- [ ] ADR-0023 (compaction at 70%, not 95%)

## Steps (P7.x)

7.1 Add `tree-sitter`, `tree-sitter-language-pack`, `lancedb`, `better-sqlite3` to deps
7.2 Write `src/context/indexer/tree-sitter.ts`
7.3 Write `src/context/indexer/semantic-chunks.ts`
7.4 Write `src/context/symbol-graph/sqlite.ts`
7.5 Write `src/context/symbol-graph/queries.ts`
7.6 Write `src/context/vector-store/lancedb.ts` (Jina code embeddings)
7.7 Write `src/context/retriever/hybrid.ts` + `rank-fusion.ts`
7.8 Write `src/context/compaction/engine.ts` + `prompt.ts`
7.9 Write `src/context/subagent/{isolation,spawn,configs}.ts`
7.10 Wire compaction trigger into AgentLoop (Phase 2)
7.11 Wire `grep`, `symbol_lookup`, `vector_search`, `spawn_subagent` tools into registry (Phase 4)
7.12 Write `src/memory/trajectory/authorship-ledger.ts` (G4)
7.13 Write tests: indexer incremental updates, symbol graph queries, hybrid retrieval, compaction, subagent budgets
7.14 ADR-0021, ADR-0022, ADR-0023
7.15 Worklog entry for Phase 7

## Key Engineering Decisions

- **Hybrid retrieval over pure vector RAG.** Claude Code/Cursor/Windsurf
  all dropped pure vector for grep. Structural (symbol graph) is the
  differentiator no incumbent combines all three.
- **Tree-sitter over LSP.** LSP varies across implementations/versions;
  tree-sitter is deterministic, complete, cacheable.
- **Compaction at 70%, not 95%.** At 90% of 1M, only ~100K free, too tight
  for 15-20K overhead. Retrieval accuracy drops from 93% (256K) to 76% (1M).
- **Tune compaction for recall first.** Losing a critical detail is worse
  than keeping a redundant one.
- **Compaction ≠ tool-result clearing.** Compaction is whole-transcript;
  clearing is sub-transcript surgical replacement of `tool_result` blocks.
- **Subagent return budget critical.** Uncapped returns defeat isolation
  (8K-token dumps into main context).
- **Per-subagent token accounting from day one.** Subagents can burn 5×
  main agent's tokens with no default tracking.
