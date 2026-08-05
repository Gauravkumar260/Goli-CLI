/**
 * Context engine public exports (Module 2).
 *
 * @module context
 */

/**
 *
 */
export type {
  SemanticChunk,
  SymbolType,
  SymbolNode,
  SymbolEdge,
  SymbolEdgeType,
  RetrievalResult,
  RetrievalStrategy,
  QueryType,
  SubagentType,
  SubagentSpawnRequest,
  SubagentResult,
  CompactionState,
} from './types.js';
/**
 *
 */
export { TreeSitterIndexer } from './indexer/tree-sitter.js';

// Real tree-sitter adapter (Hermes improvement H22, ADR-0046)
/**
 * Real tree-sitter adapter — uses native bindings when available,
 * falls back to the regex-based extractor otherwise.
 */
export {
  isRealTreeSitterAvailable,
  extractChunksWithTreeSitter,
} from './indexer/real-tree-sitter.js';

/**
 *
 */
export { SymbolGraph } from './symbol-graph/sqlite.js';
/**
 *
 */
export type { SymbolGraphOptions } from './symbol-graph/sqlite.js';
/**
 *
 */
export { HybridRetriever } from './retriever/hybrid.js';
/**
 *
 */
export type { HybridRetrieverOptions } from './retriever/hybrid.js';
/**
 *
 */
export { CompactionEngine } from './compaction/engine.js';
/**
 *
 */
export type { CompactionEngineOptions } from './compaction/engine.js';
/**
 *
 */
export { SubagentIsolator, SUBAGENT_CONFIGS } from './subagent/isolation.js';
/**
 *
 */
export type { SubagentConfig, SubagentIsolatorOptions } from './subagent/isolation.js';

/**
 * Create a context engine bundle with all components wired together.
 *
 * The returned object exposes:
 *  - `indexer` — the tree-sitter indexer (file → semantic chunks).
 *  - `symbolGraph` — the SQLite-backed symbol graph (callers/callees/imports).
 *  - `retriever` — the hybrid retrieval router (structural + lexical + semantic).
 *  - `compaction` — the context-window compaction engine.
 *  - `subagent` — the subagent isolator.
 *  - `indexWorkspace(filePaths?)` — index files into BOTH the indexer
 *    AND the symbol graph. The previous implementation created a
 *    `SymbolGraph` but never populated it — `findCallers`/`findCallees`
 *    always returned `[]` because the symbols table was empty. We
 *    now expose a single method that indexes files into both the
 *    indexer (for chunk lookup) and the symbol graph (for structural
 *    queries). Call this lazily — it's an O(files × symbols) write.
 *
 * @param opts - Configuration options.
 * @param opts.workspaceRoot
 * @param opts.logger
 * @param opts.maxContextTokens
 *   @param opts.llmClient
 * @param opts.runAgentLoop
 */
export function createContextEngine(opts: {
  workspaceRoot: string;
  logger?: import('../utils/logger.js').Logger;
  maxContextTokens?: number;
  llmClient?: CompactionEngineOptions['llmClient'];
  runAgentLoop?: SubagentIsolatorOptions['runAgentLoop'];
}): {
  indexer: TreeSitterIndexer;
  symbolGraph: SymbolGraph;
  retriever: HybridRetriever;
  compaction: CompactionEngine;
  subagent: SubagentIsolator;
  /**
   * Index files into both the tree-sitter indexer and the symbol
   * graph. Must be called before structural queries (findCallers,
   * findCallees, findImports) return non-empty results.
   *
   * @param filePaths - Absolute file paths to index. If omitted,
   *   no files are indexed (the caller must supply them).
   * @returns The number of symbols inserted into the symbol graph.
   */
  indexWorkspace: (filePaths?: string[]) => Promise<number>;
} {
  const indexer = new TreeSitterIndexer();
  const symbolGraph = new SymbolGraph({ inMemory: true });
  const retriever = new HybridRetriever({
    symbolGraph,
    indexer,
    workspaceRoot: opts.workspaceRoot,
    logger: opts.logger,
  });
  const compaction = new CompactionEngine({
    maxContextTokens: opts.maxContextTokens ?? 1_000_000,
    // Round-2 verification item #4: align with ADR-0023 dual-trigger
    // (50% in-loop / 85% safety-net). Previously 0.7 (70%), which
    // was the pre-revision ADR value — stale sibling of AgentLoop's
    // `AdvancedCompression` (which already used 0.50/0.85).
    triggerRatio: 0.5,
    llmClient: opts.llmClient,
    logger: opts.logger,
  });
  const subagent = new SubagentIsolator({
    logger: opts.logger,
    runAgentLoop:
      opts.runAgentLoop ??
      (async () => ({ content: '', ok: false, tokensUsed: 0, error: 'No agent loop provided' })),
  });

  /**
   * Index files into both the indexer and the symbol graph.
   *
   * The symbol graph requires explicit population — without this
   * call, `findCallers`/`findCallees`/`findImports` always return
   * `[]` because the symbols table is empty. This was HIGH-15: the
   * factory created the SymbolGraph but never populated it.
   */
  const indexWorkspace = async (filePaths?: string[]): Promise<number> => {
    if (!filePaths || filePaths.length === 0) return 0;
    let inserted = 0;
    for (const filePath of filePaths) {
      const chunks = await indexer.indexFileAsync(filePath);
      for (const chunk of chunks) {
        // Insert each chunk as a symbol node. The chunk ID already
        // follows the `file:line:symbolName` format expected by
        // SymbolNode.id.
        symbolGraph.upsertSymbol({
          id: chunk.id,
          name: chunk.symbolName,
          type: chunk.symbolType,
          filePath: chunk.filePath,
          line: chunk.lineRange.start,
          endLine: chunk.lineRange.end,
          language: chunk.language,
        });
        inserted++;
      }
    }
    opts.logger?.debug('Indexed workspace into symbol graph', {
      files: filePaths.length,
      symbols: inserted,
    });
    return inserted;
  };

  return { indexer, symbolGraph, retriever, compaction, subagent, indexWorkspace };
}

// Type re-exports for the factory
import { CompactionEngine } from './compaction/engine.js';
import { TreeSitterIndexer } from './indexer/tree-sitter.js';
import { HybridRetriever } from './retriever/hybrid.js';
import { SubagentIsolator } from './subagent/isolation.js';
import { SymbolGraph } from './symbol-graph/sqlite.js';

import type { CompactionEngineOptions } from './compaction/engine.js';
import type { SubagentIsolatorOptions } from './subagent/isolation.js';
