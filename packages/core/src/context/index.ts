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
 * @param opts - Configuration options.
 * @param opts.workspaceRoot
 * @param opts.logger
 * @param opts.maxContextTokens
 * @param opts.glmClient
 * @param opts.runAgentLoop
 */
export function createContextEngine(opts: {
  workspaceRoot: string;
  logger?: import('../utils/logger.js').Logger;
  maxContextTokens?: number;
  glmClient?: CompactionEngineOptions['glmClient'];
  runAgentLoop?: SubagentIsolatorOptions['runAgentLoop'];
}): {
  indexer: TreeSitterIndexer;
  symbolGraph: SymbolGraph;
  retriever: HybridRetriever;
  compaction: CompactionEngine;
  subagent: SubagentIsolator;
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
    triggerRatio: 0.7,
    glmClient: opts.glmClient,
    logger: opts.logger,
  });
  const subagent = new SubagentIsolator({
    logger: opts.logger,
    runAgentLoop:
      opts.runAgentLoop ??
      (async () => ({ content: '', ok: false, tokensUsed: 0, error: 'No agent loop provided' })),
  });

  return { indexer, symbolGraph, retriever, compaction, subagent };
}

// Type re-exports for the factory
import { CompactionEngine } from './compaction/engine.js';
import { TreeSitterIndexer } from './indexer/tree-sitter.js';
import { HybridRetriever } from './retriever/hybrid.js';
import { SubagentIsolator } from './subagent/isolation.js';
import { SymbolGraph } from './symbol-graph/sqlite.js';

import type { CompactionEngineOptions } from './compaction/engine.js';
import type { SubagentIsolatorOptions } from './subagent/isolation.js';
