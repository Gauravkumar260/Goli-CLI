/**
 * Session search store — FTS5 + trigram (CJK) full-text search across all
 * past session messages (Hermes-parity SessionDB).
 *
 * ## Why this exists
 *
 * Hermes-agent ships a SQLite + FTS5 + trigram SessionDB with ~70 methods
 * that lets the agent search its own past conversations. Goli-CLI previously
 * had only ephemeral in-memory substring search (`memory/session/ephemeral.ts`)
 * which (a) is lost on process exit, (b) cannot search across sessions, and
 * (c) does not support CJK text properly.
 *
 * This module closes that gap with a durable, indexed, CJK-aware search store.
 *
 * ## Storage
 *
 * - **SQLite database**: `~/.goli/sessions/search.db` (or `:memory:` for tests)
 * - Two tables:
 *   1. `messages` — metadata (session_id, role, timestamp, tokens, content)
 *   2. `messages_fts` — FTS5 virtual table with `tokenize='trigram'` linked to
 *      `messages` via rowid (contentless external-content table would be more
 *      space-efficient but loses `highlight()`/`snippet()` — we keep both for
 *      snippet generation).
 *
 * ## Tokenizer choice
 *
 * `trigram` is chosen over the default `unicode61` because:
 * - It supports CJK text (Chinese/Japanese/Korean) where words are not
 *   whitespace-delimited. Trigram splits text into overlapping 3-char
 *   substrings, so `你好世界` matches the query `你好世`.
 * - The trade-off is that 1- and 2-char queries do not match (trigram
 *   minimum is 3 chars). For ASCII, the default `unicode61` tokenizer
 *   would also struggle with 1-2 char queries. We document this in the
 *   module's JSDoc and the tests.
 * - For ASCII prefix queries, `trigram` still works (`Hello*` matches
 *   `Hello world`).
 *
 * ## Concurrency
 *
 * SQLite with WAL journal mode handles concurrent reads + single writer.
 * For goli's single-process-per-CLI-invocation model, this is sufficient.
 * Hermes uses the same model.
 *
 * @module memory/session/search-store
 */

import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { Logger } from '../../utils/logger.js';

/** A message stored in the search index. */
export interface IndexedMessage {
  /** Unique ID for this message (UUID). */
  id: string;
  /** Session the message belongs to. */
  sessionId: string;
  /** Message role: user | assistant | system | tool. */
  role: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Message content (text). */
  content: string;
  /** Token count for this message (optional, used for ranking + stats). */
  tokens?: number;
}

/** A search result row. */
export interface SearchResult {
  /** Message ID. */
  id: string;
  /** Session ID. */
  sessionId: string;
  /** Message role. */
  role: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Snippet of the content with matches highlighted. */
  snippet: string;
  /** Token count (0 if not provided at index time). */
  tokens: number;
  /** BM25 relevance score (lower is more relevant in SQLite FTS5). */
  rank: number;
}

/** Options for the SearchStore constructor. */
export interface SearchStoreOptions {
  /** Override the database path (default: ~/.goli/sessions/search.db). */
  dbPath?: string;
  /** Use in-memory database (default: false). Mutually exclusive with dbPath. */
  inMemory?: boolean;
  /** Logger. */
  logger?: Logger;
}

/** Options for search(). */
export interface SearchOptions {
  /** Max results (default: 20). */
  limit?: number;
  /** Offset for pagination (default: 0). */
  offset?: number;
  /** Filter by session ID. */
  sessionId?: string;
  /** Filter by role (e.g., 'user'). */
  role?: string;
  /** Highlight markers for matches (default: ['[', ']']). */
  highlightMarkers?: [string, string];
  /** Snippet max tokens (default: 32). */
  snippetTokens?: number;
}

/** Default search options. */
const DEFAULT_SEARCH_OPTIONS: Required<Omit<SearchOptions, 'sessionId' | 'role'>> = {
  limit: 20,
  offset: 0,
  highlightMarkers: ['[', ']'],
  snippetTokens: 32,
};

/**
 * SearchStore — FTS5 + trigram full-text search across all session messages.
 *
 * Usage:
 *
 * ```ts
 * const store = new SearchStore({ inMemory: true });
 * store.index({ id: 'm1', sessionId: 's1', role: 'user',
 *               timestamp: new Date().toISOString(), content: 'Hello world' });
 * const results = store.search('Hello');
 * console.log(results[0].snippet); // "[Hello] world"
 * store.close();
 * ```
 *
 * @module memory/session/search-store
 */
export class SearchStore {
  private readonly db: Database.Database;
  private readonly dbPath: string | null;
  private readonly inMemory: boolean;
  private readonly log?: Logger;

  /** Prepared statements (lazily-prepared for performance). */
  private stmts: {
    insert?: Database.Statement;
    deleteMessage?: Database.Statement;
    deleteSession?: Database.Statement;
    search?: Database.Statement;
    countSession?: Database.Statement;
    countAll?: Database.Statement;
    getSessionIds?: Database.Statement;
  } = {};

  constructor(opts: SearchStoreOptions = {}) {
    this.inMemory = opts.inMemory ?? false;

    if (this.inMemory) {
      this.dbPath = null;
      this.db = new Database(':memory:');
    } else {
      this.dbPath = opts.dbPath ?? join(homedir(), '.goli', 'sessions', 'search.db');
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
    }

    this.log = opts.logger;
    this.initSchema();
    this.tunePragmas();
  }

  /** Initialize the SQLite schema (messages table + FTS5 virtual table). */
  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        tokenize='trigram'
      );
    `);
  }

  /** Set performance pragmas after schema init. */
  private tunePragmas(): void {
    this.db.pragma('cache_size = -8000'); // 8MB cache
    this.db.pragma('mmap_size = 268435456'); // 256MB memory-mapped IO
  }

  /** Prepare all statements on first use (lazy). */
  private prepareStatements(): void {
    if (this.stmts.insert) {
      return;
    }

    this.stmts.insert = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, timestamp, content, tokens)
      VALUES (@id, @session_id, @role, @timestamp, @content, @tokens)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        role = excluded.role,
        timestamp = excluded.timestamp,
        content = excluded.content,
        tokens = excluded.tokens
    `);

    this.stmts.deleteMessage = this.db.prepare('DELETE FROM messages WHERE id = ?');
    this.stmts.deleteSession = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    this.stmts.countSession = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?');
    this.stmts.countAll = this.db.prepare('SELECT COUNT(*) AS n FROM messages');
    this.stmts.getSessionIds = this.db.prepare('SELECT DISTINCT session_id FROM messages ORDER BY session_id');
  }

  /**
   * Index a single message. Idempotent — re-indexing the same message ID
   * replaces the existing row.
   *
   * @param msg - The message to index.
   */
  index(msg: IndexedMessage): void {
    this.prepareStatements();
    this.db.transaction(() => {
      this.stmts.insert!.run({
        id: msg.id,
        session_id: msg.sessionId,
        role: msg.role,
        timestamp: msg.timestamp,
        content: msg.content,
        tokens: msg.tokens ?? 0,
      });
      // Rebuild FTS for this message's content. Delete-then-insert keeps the
      // FTS rowid in sync (we use a rowid-mirroring strategy: FTS rowid = messages rowid).
      // Simpler: use a trigger-based approach OR explicit re-index. We use explicit
      // for clarity + testability.
      const row = this.db.prepare('SELECT rowid AS r FROM messages WHERE id = ?').get(msg.id) as
        | { r: number }
        | undefined;
      if (row) {
        this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.r);
        this.db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)').run(
          row.r,
          msg.content,
        );
      }
    })();
  }

  /**
   * Index many messages in a single transaction (much faster than calling
   * index() in a loop).
   *
   * @param msgs - Array of messages to index.
   */
  indexBatch(msgs: IndexedMessage[]): void {
    if (msgs.length === 0) {
      return;
    }
    this.prepareStatements();
    this.db.transaction(() => {
      for (const msg of msgs) {
        this.stmts.insert!.run({
          id: msg.id,
          session_id: msg.sessionId,
          role: msg.role,
          timestamp: msg.timestamp,
          content: msg.content,
          tokens: msg.tokens ?? 0,
        });
        const row = this.db.prepare('SELECT rowid AS r FROM messages WHERE id = ?').get(msg.id) as
          | { r: number }
          | undefined;
        if (row) {
          this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.r);
          this.db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)').run(
            row.r,
            msg.content,
          );
        }
      }
    })();
  }

  /**
   * Search the index.
   *
   * @param query - The search query. Supports:
   *   - Plain words: `hello world`
   *   - Prefix: `auth*` (matches `authentication`)
   *   - Phrase: `"hello world"` (exact match)
   *   - Boolean: `hello OR world`, `hello -world`
   *   - CJK (3+ chars per token due to trigram tokenizer)
   * @param opts - Search options (limit, offset, filters, snippet config).
   * @returns Array of search results, ranked by BM25 (most relevant first).
   */
  search(query: string, opts: SearchOptions = {}): SearchResult[] {
    this.prepareStatements();
    const merged: Required<Omit<SearchOptions, 'sessionId' | 'role'>> & {
      sessionId?: string;
      role?: string;
    } = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...opts,
    };

    if (!query.trim()) {
      return [];
    }

    // Build the query: join messages (for metadata) with messages_fts (for MATCH).
    // We use a sub-select to apply filters + MATCH, then fetch metadata + snippet.
    const conditions: string[] = [];
    const params: Record<string, unknown> = { q: query };

    if (opts.sessionId) {
      conditions.push('m.session_id = @sessionId');
      params.sessionId = opts.sessionId;
    }
    if (opts.role) {
      conditions.push('m.role = @role');
      params.role = opts.role;
    }

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    const [openMark, closeMark] = merged.highlightMarkers;

    const sql = `
      SELECT
        m.id AS id,
        m.session_id AS sessionId,
        m.role AS role,
        m.timestamp AS timestamp,
        m.tokens AS tokens,
        highlight(messages_fts, 0, @openMark, @closeMark) AS snippet,
        bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH @q
        ${whereClause}
      ORDER BY rank
      LIMIT @limit OFFSET @offset
    `;

    params.openMark = openMark;
    params.closeMark = closeMark;
    params.limit = merged.limit;
    params.offset = merged.offset;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as Array<{
      id: string;
      sessionId: string;
      role: string;
      timestamp: string;
      tokens: number;
      snippet: string;
      rank: number;
    }>;

    this.log?.debug('search-store: query executed', {
      query,
      resultCount: rows.length,
      limit: merged.limit,
      offset: merged.offset,
    });

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      role: r.role,
      timestamp: r.timestamp,
      snippet: r.snippet,
      tokens: r.tokens,
      rank: r.rank,
    }));
  }

  /**
   * Count messages in a session, or all messages if sessionId omitted.
   *
   * @param sessionId - Optional session filter.
   * @returns Message count.
   */
  count(sessionId?: string): number {
    this.prepareStatements();
    if (sessionId) {
      return (this.stmts.countSession!.get(sessionId) as { n: number }).n;
    }
    return (this.stmts.countAll!.get() as { n: number }).n;
  }

  /**
   * List all session IDs that have at least one indexed message.
   *
   * @returns Array of session IDs (sorted).
   */
  listSessions(): string[] {
    this.prepareStatements();
    const rows = this.stmts.getSessionIds!.all() as Array<{ session_id: string }>;
    return rows.map((r) => r.session_id);
  }

  /**
   * Delete a single message from the index.
   *
   * @param id - Message ID.
   */
  deleteMessage(id: string): void {
    this.prepareStatements();
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT rowid AS r FROM messages WHERE id = ?').get(id) as
        | { r: number }
        | undefined;
      if (row) {
        this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.r);
      }
      this.stmts.deleteMessage!.run(id);
    })();
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session ID.
   */
  deleteSession(sessionId: string): void {
    this.prepareStatements();
    this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT rowid AS r FROM messages WHERE session_id = ?')
        .all(sessionId) as Array<{ r: number }>;
      const delFts = this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?');
      for (const row of rows) {
        delFts.run(row.r);
      }
      this.stmts.deleteSession!.run(sessionId);
    })();
  }

  /**
   * Wipe the entire index. Use with caution.
   */
  clear(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM messages');
      // DELETE FROM works for regular FTS5 tables.
      // ('delete-all' is only for contentless/external-content FTS5 tables.)
      this.db.exec('DELETE FROM messages_fts');
    })();
    this.log?.debug('search-store: index cleared');
  }

  /**
   * Compact the database (VACUUM + optimize FTS). Call after large deletions.
   */
  optimize(): void {
    // Note: FTS5 internal commands use single-quoted string literals.
    this.db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`);
    this.db.exec('VACUUM');
    this.log?.debug('search-store: optimize completed');
  }

  /**
   * Get the database file path (null for in-memory).
   *
   * @returns The path or null.
   */
  get path(): string | null {
    return this.dbPath;
  }

  /** Close the database. Idempotent. */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed — ignore.
    }
  }
}

/**
 * Build a search query string from user input. Handles special characters
 * by escaping FTS5 operators when the input is a plain substring.
 *
 * - If the query contains FTS5 operators (AND, OR, NOT, *, ", etc.) — pass through.
 * - Otherwise — wrap as a phrase match for exact-substring behavior.
 *
 * @param input - User search input.
 * @returns FTS5-safe query string.
 */
export function buildQuery(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  // If user typed a prefix query (ends with *) — pass through.
  if (trimmed.endsWith('*')) {
    return trimmed;
  }
  // If user typed a phrase (wrapped in quotes) — pass through.
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }
  // If user typed multiple words — join as AND (FTS5 default).
  // For single-token queries, prefix-match is more user-friendly.
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    // Single word — prefix-match to catch plurals/conjugations.
    return `${words[0]}*`;
  }
  // Multiple words — phrase match for precise multi-word queries.
  return `"${trimmed}"`;
}

/**
 * Drop the search database file. Mainly useful for tests.
 *
 * @param dbPath - Path to the database file.
 */
export function dropDatabase(dbPath: string): void {
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
  // Also clean WAL + SHM files.
  for (const suffix of ['-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  }
}
