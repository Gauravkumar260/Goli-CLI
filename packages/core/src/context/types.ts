/**
 * Context engine types (Module 2).
 *
 * Defines the core data structures for the context engine: semantic
 * chunks, symbol graph nodes/edges, retrieval results, and compaction
 * state.
 *
 * @module context/types
 */

/** A semantic chunk extracted from a source file via tree-sitter. */
export interface SemanticChunk {
  /** Unique ID (content hash). */
  id: string;
  /** The file path (absolute). */
  filePath: string;
  /** The language (e.g. 'typescript', 'python', 'rust'). */
  language: string;
  /** The line range (1-based, inclusive). */
  lineRange: { start: number; end: number };
  /** The raw source code of the chunk. */
  code: string;
  /** The symbol name (e.g. function/class/method name). */
  symbolName: string;
  /** The symbol type (function, class, method, interface, etc.). */
  symbolType: SymbolType;
  /** The docstring/JSDoc comment (if any). */
  docstring?: string;
  /** Content hash for dedup (SHA-256 of the code). */
  contentHash: string;
  /** Vector embedding (if computed). */
  embedding?: number[];
}

/** The type of a symbol in the symbol graph. */
export type SymbolType =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'import'
  | 'export'
  | 'module';

/** A node in the symbol graph. */
export interface SymbolNode {
  /** Unique ID (file:line:symbolName). */
  id: string;
  /** The symbol name. */
  name: string;
  /** The symbol type. */
  type: SymbolType;
  /** The file path. */
  filePath: string;
  /** The line number (1-based). */
  line: number;
  /** The end line (1-based, inclusive). */
  endLine: number;
  /** The language. */
  language: string;
}

/** An edge in the symbol graph (directed). */
export interface SymbolEdge {
  /** The source symbol ID. */
  source: string;
  /** The target symbol ID. */
  target: string;
  /** The edge type. */
  type: SymbolEdgeType;
}

/** The type of a symbol graph edge. */
export type SymbolEdgeType = 'calls' | 'imports' | 'defines' | 'implements' | 'extends';

/** A retrieval result from the hybrid retriever. */
export interface RetrievalResult {
  /** The chunk or symbol that matched. */
  chunk?: SemanticChunk;
  /** The symbol node (for structural results). */
  symbol?: SymbolNode;
  /** The file path. */
  filePath: string;
  /** The line range. */
  lineRange?: { start: number; end: number };
  /** The matching content (for lexical results). */
  content?: string;
  /** The relevance score (0.0 – 1.0). */
  score: number;
  /** Which retrieval strategy found this result. */
  strategy: RetrievalStrategy;
}

/** The retrieval strategy used. */
export type RetrievalStrategy = 'structural' | 'lexical' | 'semantic' | 'hybrid';

/** The type of a retrieval query. */
export type QueryType = 'structural' | 'lexical' | 'semantic' | 'hybrid' | 'auto';

/** A subagent type for context isolation. */
export type SubagentType = 'research' | 'implementation' | 'review';

/** A subagent spawn request. */
export interface SubagentSpawnRequest {
  /** A description of the subagent's task. */
  description: string;
  /** The prompt for the subagent. */
  prompt: string;
  /** The subagent type. */
  type: SubagentType;
  /** Max tokens for the return summary (default: 1000). */
  maxReturnTokens?: number;
}

/** A subagent result. */
export interface SubagentResult {
  /** The distilled summary (within the return budget). */
  summary: string;
  /** Whether the subagent succeeded. */
  ok: boolean;
  /** Error message (if any). */
  error?: string;
  /** Tokens consumed. */
  tokensUsed: number;
  /** Duration in ms. */
  durationMs: number;
}

/** The compaction state. */
export interface CompactionState {
  /** Whether compaction is needed. */
  needed: boolean;
  /** The current token count. */
  currentTokens: number;
  /** The token limit. */
  tokenLimit: number;
  /** The ratio (0.0 – 1.0). */
  ratio: number;
}
