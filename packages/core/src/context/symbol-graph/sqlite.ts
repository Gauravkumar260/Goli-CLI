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
    }
    this.initSchema();
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
   * @param node
   */
  upsertSymbol(node: SymbolNode): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, name, type, file_path, line, end_line, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
}
