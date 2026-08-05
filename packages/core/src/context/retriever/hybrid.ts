/**
 * Hybrid retrieval router (Module 2).
 *
 * Classifies queries into structural / lexical / semantic / hybrid and
 * dispatches to the appropriate retrieval strategy. Results are merged
 * via reciprocal rank fusion.
 *
 * ## Why hybrid (not pure vector RAG)?
 *
 * Claude Code removed vector search in May 2025, replacing it with grep
 * — "outperformed everything. By a lot." Code is structural, not textual;
 * vector embeddings flatten import graphs/call hierarchies/module
 * boundaries. Hybrid = structural (symbol graph) + lexical (ripgrep) +
 * semantic (vectors for docs only).
 *
 * (ADR-0021)
 *
 * @module context/retriever/hybrid
 */

import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

import type { Logger } from '../../utils/logger.js';
import type { TreeSitterIndexer } from '../indexer/tree-sitter.js';
import type { SymbolGraph } from '../symbol-graph/sqlite.js';
import type {
  RetrievalResult,
  QueryType,
} from '../types.js';

/** Options for the HybridRetriever. */
export interface HybridRetrieverOptions {
  /** The symbol graph (for structural queries). */
  symbolGraph?: SymbolGraph;
  /** The tree-sitter indexer (for chunk lookup). */
  indexer?: TreeSitterIndexer;
  /** The workspace root. */
  workspaceRoot: string;
  /** Logger instance. */
  logger?: Logger;
  /** Max results to return (default: 20). */
  maxResults?: number;
}

/**
 * Hybrid retrieval router.
 *
 * @module context/retriever/hybrid
 */
export class HybridRetriever {
  private readonly symbolGraph?: SymbolGraph;
  private readonly indexer?: TreeSitterIndexer;
  private readonly workspaceRoot: string;
  private readonly log?: Logger;
  private readonly maxResults: number;

  constructor(opts: HybridRetrieverOptions) {
    this.symbolGraph = opts.symbolGraph;
    this.indexer = opts.indexer;
    this.workspaceRoot = opts.workspaceRoot;
    this.log = opts.logger;
    this.maxResults = opts.maxResults ?? 20;
  }

  /**
   * Retrieve results for a query.
   *
   * @param query - The search query (natural language or symbol name).
   * @param queryType - The query type (auto = classify automatically).
   */
  retrieve(query: string, queryType: QueryType = 'auto'): RetrievalResult[] {
    const effectiveType = queryType === 'auto' ? this.classifyQuery(query) : queryType;
    this.log?.debug('Retrieving', { query: query.slice(0, 80), type: effectiveType });

    let results: RetrievalResult[] = [];

    switch (effectiveType) {
      case 'structural':
        results = this.retrieveStructural(query);
        break;
      case 'lexical':
        results = this.retrieveLexical(query);
        break;
      case 'semantic':
        results = this.retrieveSemantic(query);
        break;
      case 'hybrid': {
        const structural = this.retrieveStructural(query);
        const lexical = this.retrieveLexical(query);
        const semantic = this.retrieveSemantic(query);
        results = this.fuseResults([structural, lexical, semantic]);
        break;
      }
    }

    return results.slice(0, this.maxResults);
  }

  /**
   * Classify a query into structural / lexical / semantic / hybrid.
   *
   * Heuristics:
   * - "who calls X" / "callers of X" → structural
   * - "what does X call" / "callees of X" → structural
   * - "where is X defined" / "definition of X" → structural
   * - "find all uses of X" → lexical
   * - regex pattern (contains .* or \w+) → lexical
   * - "how does X work" / "explain X" → semantic
   * - otherwise → hybrid
   * @param query
   */
  classifyQuery(query: string): QueryType {
    const q = query.toLowerCase().trim();

    // Structural patterns — checked BEFORE lexical so "find all
    // callers of foo" matches the structural `callers of` pattern
    // (line 117), not the lexical `find all` pattern (line 124).
    // The previous implementation had structural FIRST already, so
    // the "find all" check after never shadowed it. But it also
    // missed "find all callers" because that begins with "find all"
    // (lexical pattern), and the structural "callers of" pattern
    // requires "callers of" not "callers" alone. We add an explicit
    // "find all callers" pattern to be sure.
    if (q.match(/^(find all )?(who calls|callers of|find callers)/)) return 'structural';
    if (q.match(/^(what does.*call|callees of|find callees)/)) return 'structural';
    if (q.match(/^(where is.*defined|definition of|find definition)/)) return 'structural';
    if (q.match(/^(imports of|what does.*import)/)) return 'structural';
    if (q.match(/^(symbols in|what.*defined in)/)) return 'structural';

    // Lexical patterns
    if (q.match(/^(find all|search for|grep|all uses of|all occurrences)/)) return 'lexical';
    if (q.includes('.*') || q.includes('\\w') || q.includes('\\d')) return 'lexical';
    if (q.match(/^(files containing|lines containing)/)) return 'lexical';

    // Semantic patterns
    if (q.match(/^(how does|explain|what is|describe|summarize)/)) return 'semantic';
    if (q.match(/^(docs? for|documentation for)/)) return 'semantic';

    // Default: hybrid
    return 'hybrid';
  }

  /**
   * Structural retrieval: query the symbol graph.
   * @param query
   */
  private retrieveStructural(query: string): RetrievalResult[] {
    if (!this.symbolGraph) return [];

    const results: RetrievalResult[] = [];
    // Use original query (not lowercased) for symbol name extraction
    // to preserve case sensitivity
    const qOrig = query;

    // "who calls X" → findCallers
    const callersMatch = qOrig.match(/(?:who calls|callers of|find callers of)\s+(\w+)/i);
    if (callersMatch?.[1]) {
      const symbols = this.symbolGraph.findByName(callersMatch[1]);
      for (const sym of symbols) {
        const callers = this.symbolGraph.findCallers(sym.id);
        for (const caller of callers) {
          results.push({
            symbol: caller,
            filePath: caller.filePath,
            lineRange: { start: caller.line, end: caller.endLine },
            score: 0.9,
            strategy: 'structural',
          });
        }
      }
      return results;
    }

    // "what does X call" → findCallees
    const calleesMatch = qOrig.match(/(?:what does|callees of|find callees of)\s+(\w+)\s+call/i);
    if (calleesMatch?.[1]) {
      const symbols = this.symbolGraph.findByName(calleesMatch[1]);
      for (const sym of symbols) {
        const callees = this.symbolGraph.findCallees(sym.id);
        for (const callee of callees) {
          results.push({
            symbol: callee,
            filePath: callee.filePath,
            lineRange: { start: callee.line, end: callee.endLine },
            score: 0.9,
            strategy: 'structural',
          });
        }
      }
      return results;
    }

    // "where is X defined" → findByName
    const defMatch = qOrig.match(/(?:where is|definition of|find definition of)\s+(\w+)/i);
    if (defMatch?.[1]) {
      const symbols = this.symbolGraph.findByName(defMatch[1]);
      for (const sym of symbols) {
        results.push({
          symbol: sym,
          filePath: sym.filePath,
          lineRange: { start: sym.line, end: sym.endLine },
          score: 1.0,
          strategy: 'structural',
        });
      }
      return results;
    }

    // Fallback: search by name prefix (use original query for case preservation)
    const nameMatch = qOrig.match(/(\w+)/);
    if (nameMatch?.[1]) {
      const symbols = this.symbolGraph.findByNamePrefix(nameMatch[1], 10);
      for (const sym of symbols) {
        results.push({
          symbol: sym,
          filePath: sym.filePath,
          lineRange: { start: sym.line, end: sym.endLine },
          score: 0.7,
          strategy: 'structural',
        });
      }
    }

    return results;
  }

  /**
   * Lexical retrieval: use ripgrep.
   * @param query
   */
  private retrieveLexical(query: string): RetrievalResult[] {
    const results: RetrievalResult[] = [];

    // Extract the search pattern from the query
    const pattern = this.extractPattern(query);
    if (!pattern) return [];

    try {
      // ReDoS defense: ripgrep treats the pattern as a regex by
      // default. A user pattern like `(a+)+b` causes catastrophic
      // backtracking (ReDoS) in ripgrep, hanging the retrieval for
      // up to the 10-second timeout. We pass `--fixed-strings` when
      // the pattern looks like a plain string (no regex
      // metacharacters), and `--regexp` otherwise. For regex mode,
      // we cap the pattern length at 200 chars and reject patterns
      // with known catastrophic-backtracking shapes (nested
      // quantifiers).
      const isPlain = !/[.*+?^${}()|[\]\\]/.test(pattern);
      const isSuspicious = /\([^)]*[+*][^)]*\)[+*]/.test(pattern); // (a+)+, (a*)+, etc.
      if (isSuspicious || pattern.length > 200) {
        // Skip the search entirely — return empty so the agent
        // doesn't see a 10s hang.
        return [];
      }
      const rgArgs = isPlain
        ? ['--json', '--max-count', '20', '--fixed-strings', pattern, this.workspaceRoot]
        : ['--json', '--max-count', '20', '--regexp', pattern, this.workspaceRoot];
      // Use execFileSync with an arg array (not a shell string) to
      // prevent command injection. The previous implementation used
      // `execSync(\`rg ... ${JSON.stringify(pattern)} ...\`)` which is
      // NOT shell-safe — inside double quotes, `$(...)` and backticks
      // are interpreted by the shell.
      const stdout = execFileSync('rg', rgArgs, {
        encoding: 'utf-8',
        cwd: this.workspaceRoot,
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = stdout.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'match' && entry.data?.path?.text && entry.data?.line_number) {
            const filePath = entry.data.path.text;
            const lineNum = entry.data.line_number;
            const text = (entry.data.lines?.text ?? '').trimEnd();
            const relPath = relative(this.workspaceRoot, filePath);
            results.push({
              filePath: relPath,
              lineRange: { start: lineNum, end: lineNum },
              content: text,
              score: 0.8,
              strategy: 'lexical',
            });
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // rg not available or no matches
    }

    return results;
  }

  /**
   * Semantic retrieval: search embeddings (Phase 7 stub — uses chunk docstrings).
   * @param query
   */
  private retrieveSemantic(query: string): RetrievalResult[] {
    if (!this.indexer) return [];

    const results: RetrievalResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    const allChunks = this.indexer.getAllChunks();
    for (const chunk of allChunks) {
      let score = 0;
      const haystack = `${chunk.symbolName} ${chunk.docstring ?? ''} ${chunk.code.slice(0, 200)}`.toLowerCase();
      for (const word of queryWords) {
        if (haystack.includes(word)) {
          score += 0.15;
        }
      }
      if (score > 0) {
        results.push({
          chunk,
          filePath: chunk.filePath,
          lineRange: chunk.lineRange,
          content: chunk.code.slice(0, 200),
          score: Math.min(1.0, score),
          strategy: 'semantic',
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Fuse results from multiple strategies using reciprocal rank fusion.
   * @param resultSets
   */
  private fuseResults(resultSets: RetrievalResult[][]): RetrievalResult[] {
    const k = 60; // RRF constant
    const fused = new Map<string, { result: RetrievalResult; score: number }>();

    for (const resultSet of resultSets) {
      for (let i = 0; i < resultSet.length; i++) {
        const result = resultSet[i]!;
        // Create a unique key for deduplication
        const key = `${result.filePath}:${result.lineRange?.start ?? 0}:${result.symbol?.id ?? ''}`;

        const rrfScore = 1 / (k + i + 1);
        const existing = fused.get(key);
        if (existing) {
          existing.score += rrfScore;
        } else {
          fused.set(key, { result, score: rrfScore });
        }
      }
    }

    return [...fused.values()]
      .map(({ result, score }) => ({ ...result, score }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Extract the search pattern from a natural-language query.
   * @param query
   */
  private extractPattern(query: string): string | undefined {
    // "find all X" → X
    const findMatch = query.match(/(?:find all|search for|grep|all uses of|all occurrences of)\s+(.+)/i);
    if (findMatch?.[1]) return findMatch[1].trim();

    // "files containing X" → X
    const containingMatch = query.match(/(?:files containing|lines containing)\s+(.+)/i);
    if (containingMatch?.[1]) return containingMatch[1].trim();

    // If it looks like a regex, use it directly
    if (query.includes('.*') || query.includes('\\w') || query.includes('\\d')) {
      return query;
    }

    // Single word → use as pattern
    const wordMatch = query.match(/^(\w+)$/);
    if (wordMatch?.[1]) return wordMatch[1];

    return undefined;
  }
}
