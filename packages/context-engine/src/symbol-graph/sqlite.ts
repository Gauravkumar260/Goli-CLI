/**
 * SQLite-backed symbol graph (Module 2).
 *
 * Stores a directed graph of symbol definitions, calls, and imports.
 * Supports `findCallers`, `findCallees`, `findImports` queries.
 *
 * The symbol graph is the "structural retrieval" layer of the hybrid
 * retriever — it answers questions like "who calls this function?" and
 * "what does this module import?" without reading file contents.
 *
 * ## Why SQLite?
 *
 * - Persistent (survives restarts)
 * - Fast (indexed lookups)
 * - No server (embedded, like LanceDB)
 * - Standard (available everywhere)
 *
 * @module context/symbol-graph/sqlite
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

import type { SymbolNode, SymbolEdge, SymbolType } from '../types.js';

/** Options for the SymbolGraph. */
export interface SymbolGraphOptions {
  /** The database path (default: $GOLI_HOME/symbol-graph.db). */
  dbPath?: string;
  /** Whether to use in-memory mode (for tests). */
  inMemory?: boolean;
}

/**
 * SQLite-backed symbol graph.
 *
 * @module context/symbol-graph/sqlite
 */
export class SymbolGraph {
  private readonly db: Database.Database;

  constructor(opts: SymbolGraphOptions = {}) {
    if (opts.inMemory) {
      this.db = new Database(':memory:');
    } else {
      const dbPath = opts.dbPath ?? this.defaultDbPath();
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      // Enable WAL mode so concurrent reads are not blocked during
      // writes. The default journal mode is `DELETE` (rollback
      // journal), which means readers are blocked while a write
      // transaction is in progress. For a symbol graph that may be
      // queried during indexing, this causes contention. WAL mode
      // allows readers to proceed concurrently with a single
      // writer. `synchronous = NORMAL` is safe with WAL and avoids
      // an fsync on every commit.
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    }
    this.initSchema();
    // Register an exit handler so the SQLite database is closed
    // cleanly on process exit. Without this, a SIGKILL or OOM
    // could leave the database in an inconsistent state (WAL
    // file not checkpointed). For a persistent DB this could
    // corrupt the symbol graph.
    process.on('exit', () => this.close());
  }

  /** Default database path. */
  private defaultDbPath(): string {
    const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
    return join(goliHome, 'symbol-graph.db');
  }

  /** Initialize the SQLite schema. */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        language TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

      CREATE TABLE IF NOT EXISTS edges (
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        type TEXT NOT NULL,
        PRIMARY KEY (source, target, type)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    `);
  }

  /**
   * Insert or update a symbol.
   *
   * The previous implementation used `INSERT OR REPLACE INTO symbols`
   * which, in SQLite, deletes the existing row (firing DELETE
   * triggers) and inserts a new one with the same ID. The edges
   * table doesn't have FK constraints, so edges survive the
   * replace — but any future trigger or FK would break. We now
   * use `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` which is
   * a true upsert (no delete + re-insert), preserving edges and
   * avoiding trigger side effects.
   * @param node
   */
  upsertSymbol(node: SymbolNode): void {
    this.db.prepare(`
      INSERT INTO symbols (id, name, type, file_path, line, end_line, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        file_path = excluded.file_path,
        line = excluded.line,
        end_line = excluded.end_line,
        language = excluded.language
    `).run(node.id, node.name, node.type, node.filePath, node.line, node.endLine, node.language);
  }

  /**
   * Insert an edge.
   * @param edge
   */
  upsertEdge(edge: SymbolEdge): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO edges (source, target, type) VALUES (?, ?, ?)
    `).run(edge.source, edge.target, edge.type);
  }

  /**
   * Find a symbol by name (exact match).
   * @param name
   */
  findByName(name: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM symbols WHERE name = ?
    `).all(name) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Find symbols by name prefix (for autocomplete).
   * @param prefix
   * @param limit
   */
  findByNamePrefix(prefix: string, limit: number = 20): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM symbols WHERE name LIKE ? LIMIT ?
    `).all(`${prefix}%`, limit) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Find all callers of a symbol (who calls this function?).
   * @param symbolId
   */
  findCallers(symbolId: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN edges e ON e.source = s.id
      WHERE e.target = ? AND e.type = 'calls'
    `).all(symbolId) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Find all callees of a symbol (what does this function call?).
   * @param symbolId
   */
  findCallees(symbolId: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN edges e ON e.target = s.id
      WHERE e.source = ? AND e.type = 'calls'
    `).all(symbolId) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Find all imports of a module/symbol.
   * @param symbolId
   */
  findImports(symbolId: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN edges e ON e.target = s.id
      WHERE e.source = ? AND e.type = 'imports'
    `).all(symbolId) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Find all symbols defined in a file.
   * @param filePath
   */
  findByFile(filePath: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM symbols WHERE file_path = ? ORDER BY line
    `).all(filePath) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * Remove all symbols for a file (for re-indexing).
   * @param filePath
   */
  removeFile(filePath: string): void {
    const deleteEdges = this.db.prepare(`
      DELETE FROM edges WHERE source IN (SELECT id FROM symbols WHERE file_path = ?)
                          OR target IN (SELECT id FROM symbols WHERE file_path = ?)
    `);
    const deleteSymbols = this.db.prepare(`DELETE FROM symbols WHERE file_path = ?`);
    const tx = this.db.transaction(() => {
      deleteEdges.run(filePath, filePath);
      deleteSymbols.run(filePath);
    });
    tx();
  }

  /** Get the total symbol count. */
  get symbolCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM symbols`).get() as { count: number };
    return row.count;
  }

  /** Get the total edge count. */
  get edgeCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM edges`).get() as { count: number };
    return row.count;
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }

  /**
   * Convert a DB row to a SymbolNode.
   * @param row
   * @param row.id
   * @param row.name
   * @param row.type
   * @param row.file_path
   * @param row.line
   * @param row.end_line
   * @param row.language
   */
  private rowToNode(row: {
    id: string; name: string; type: string; file_path: string;
    line: number; end_line: number; language: string;
  }): SymbolNode {
    return {
      id: row.id,
      name: row.name,
      type: row.type as SymbolType,
      filePath: row.file_path,
      line: row.line,
      endLine: row.end_line,
      language: row.language,
    };
  }

  /**
   * P1-19 fix (remediation plan Phase 19): find all definitions of a
   * symbol by name.
   *
   * "Definitions" are symbols with a definition-like type (function,
   * class, method, interface, type). Returns all matches across the
   * workspace.
   *
   * @param symbolName - The symbol name (exact match, case-sensitive).
   * @returns All definition nodes matching the name.
   */
  findDefinitions(symbolName: string): SymbolNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM symbols
      WHERE name = ? AND type IN ('function', 'class', 'method', 'interface', 'type')
      ORDER BY file_path, line
    `).all(symbolName) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    return rows.map(this.rowToNode);
  }

  /**
   * P1-19: find symbols with names similar to the query (fuzzy match).
   *
   * Uses a substring + Levenshtein-distance heuristic (implemented in
   * JS, not SQLite — `better-sqlite3` doesn't ship with the
   * Levenshtein extension by default). Returns up to `limit` results
   * sorted by edit distance (ascending).
   *
   * @param symbolName - The query name.
   * @param limit - Max results. Default 10.
   * @returns Symbols with similar names, sorted by edit distance.
   */
  findSimilar(symbolName: string, limit: number = 10): SymbolNode[] {
    const lower = symbolName.toLowerCase();
    const rows = this.db.prepare(`
      SELECT * FROM symbols
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY name
      LIMIT ?
    `).all('%' + lower + '%', limit * 2) as Array<{
      id: string; name: string; type: string; file_path: string;
      line: number; end_line: number; language: string;
    }>;
    const nodes = rows.map(this.rowToNode);
    const ranked = nodes
      .map((n) => ({ node: n, dist: levenshtein(lower, n.name.toLowerCase()) }))
      .sort((a, b) => a.dist - b.dist);
    return ranked.slice(0, limit).map((r) => r.node);
  }

  /**
   * P1-19: find a call path from one symbol to another (BFS over the
   * call graph).
   *
   * Returns up to `maxPaths` distinct paths, each a list of symbols
   * starting with `fromSymbol` and ending with `toSymbol`. Paths are
   * capped at `maxDepth` edges to avoid exponential blow-up on large
   * graphs.
   *
   * @param fromSymbolId - The starting symbol ID.
   * @param toSymbolId - The target symbol ID.
   * @param maxDepth - Max path length (edges). Default 5.
   * @param maxPaths - Max paths to return. Default 3.
   * @returns Array of paths (each an array of `SymbolNode`).
   */
  findCallPath(
    fromSymbolId: string,
    toSymbolId: string,
    maxDepth: number = 5,
    maxPaths: number = 3,
  ): SymbolNode[][] {
    const paths: SymbolNode[][] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: SymbolNode[] }> = [];
    const startNode = this.getSymbolById(fromSymbolId);
    if (!startNode) return [];
    queue.push({ id: fromSymbolId, path: [startNode] });
    while (queue.length > 0 && paths.length < maxPaths) {
      const item = queue.shift()!;
      if (item.path.length - 1 >= maxDepth) continue;
      const callees = this.findCallees(item.id);
      for (const callee of callees) {
        if (callee.id === toSymbolId) {
          paths.push([...item.path, callee]);
          if (paths.length >= maxPaths) break;
          continue;
        }
        if (visited.has(callee.id)) continue;
        visited.add(callee.id);
        queue.push({ id: callee.id, path: [...item.path, callee] });
      }
    }
    return paths;
  }

  /**
   * P1-19: fetch a single symbol by ID. Helper for `findCallPath`.
   */
  private getSymbolById(symbolId: string): SymbolNode | null {
    const row = this.db.prepare('SELECT * FROM symbols WHERE id = ?').get(symbolId) as
      | { id: string; name: string; type: string; file_path: string; line: number; end_line: number; language: string }
      | undefined;
    return row ? this.rowToNode(row) : null;
  }
}

/**
 * P1-19: Standard Levenshtein distance (edit distance) between two
 * strings. Used by `findSimilar()` to rank fuzzy matches. Implemented
 * in pure JS (no native dep) — O(m*n) DP, fine for short symbol names.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use two rows (prev + curr) instead of the full matrix to save memory.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
