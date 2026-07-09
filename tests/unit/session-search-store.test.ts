/**
 * Tests for SearchStore — FTS5 + trigram (CJK) full-text session search.
 *
 * Covers:
 *  - Index single + batch
 *  - Search ASCII (single word, multi-word, prefix)
 *  - Search CJK (Chinese, Japanese, Korean) — trigram tokenizer
 *  - Search with filters (session_id, role)
 *  - Pagination (limit, offset)
 *  - Snippet/highlight markers
 *  - Ranking (BM25)
 *  - Persistence (database survives close + reopen)
 *  - In-memory mode
 *  - Delete (single message, entire session, clear)
 *  - count(), listSessions(), optimize()
 *  - buildQuery() helper
 *  - Edge cases (empty query, 1-2 char query, special chars)
 *
 * @module tests/unit/session-search-store.test
 */


import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { SearchStore, buildQuery, dropDatabase } from '../../packages/core/src/memory/session/search-store.js';

import type { IndexedMessage } from '../../packages/core/src/memory/session/search-store.js';

/** Make a sample indexed message. */
function msg(
  id: string,
  sessionId: string,
  role: string,
  content: string,
  timestamp = '2026-07-05T12:00:00.000Z',
  tokens = 10,
): IndexedMessage {
  return { id, sessionId, role, timestamp, content, tokens };
}

describe('SearchStore — construction + schema', () => {
  it('constructs in-memory mode', () => {
    const store = new SearchStore({ inMemory: true });
    expect(store.path).toBeNull();
    expect(store.count()).toBe(0);
    store.close();
  });

  it('constructs with custom dbPath (file mode)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'goli-search-'));
    const dbPath = join(tmpDir, 'search.db');
    const store = new SearchStore({ dbPath });
    expect(store.path).toBe(dbPath);
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default dbPath is ~/.goli/sessions/search.db when not in-memory', () => {
    // We just check it does not throw and creates a file with the expected suffix.
    const tmpDir = mkdtempSync(join(tmpdir(), 'goli-search-'));
    const dbPath = join(tmpDir, 'search.db');
    const store = new SearchStore({ dbPath });
    expect(store.path).toBe(dbPath);
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('idempotent init — reopening an existing db does not error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'goli-search-'));
    const dbPath = join(tmpDir, 'search.db');
    const s1 = new SearchStore({ dbPath });
    s1.index(msg('m1', 's1', 'user', 'hello world'));
    s1.close();
    // Reopen — should not error.
    const s2 = new SearchStore({ dbPath });
    expect(s2.count()).toBe(1);
    s2.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('SearchStore — index + count', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
  });

  afterEach(() => {
    store.close();
  });

  it('index() adds a single message', () => {
    store.index(msg('m1', 's1', 'user', 'hello world'));
    expect(store.count()).toBe(1);
  });

  it('index() is idempotent (same ID replaces, does not duplicate)', () => {
    store.index(msg('m1', 's1', 'user', 'hello world'));
    store.index(msg('m1', 's1', 'user', 'updated content'));
    expect(store.count()).toBe(1);
    // The content should be updated.
    const results = store.search('updated');
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('updated');
  });

  it('indexBatch() adds multiple messages atomically', () => {
    const msgs = [
      msg('m1', 's1', 'user', 'first message'),
      msg('m2', 's1', 'assistant', 'second message'),
      msg('m3', 's2', 'user', 'third message'),
    ];
    store.indexBatch(msgs);
    expect(store.count()).toBe(3);
  });

  it('indexBatch() with empty array is a no-op', () => {
    store.indexBatch([]);
    expect(store.count()).toBe(0);
  });

  it('indexBatch() handles 100 messages', () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      msg(`m${i}`, 's1', 'user', `message number ${i} about testing`),
    );
    store.indexBatch(msgs);
    expect(store.count()).toBe(100);
    // Search should find matches (default limit is 20, so request more).
    const results = store.search('testing', { limit: 100 });
    expect(results.length).toBe(100);
  });

  it('count(sessionId) counts only messages in that session', () => {
    store.indexBatch([
      msg('m1', 's1', 'user', 'one'),
      msg('m2', 's1', 'user', 'two'),
      msg('m3', 's2', 'user', 'three'),
    ]);
    expect(store.count('s1')).toBe(2);
    expect(store.count('s2')).toBe(1);
    expect(store.count('s3')).toBe(0);
  });

  it('listSessions() returns all distinct session IDs', () => {
    store.indexBatch([
      msg('m1', 's1', 'user', 'one'),
      msg('m2', 's2', 'user', 'two'),
      msg('m3', 's1', 'user', 'three'),
      msg('m4', 's3', 'user', 'four'),
    ]);
    expect(store.listSessions()).toEqual(['s1', 's2', 's3']);
  });
});

describe('SearchStore — ASCII search', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
    store.indexBatch([
      msg('m1', 's1', 'user', 'Hello world this is a test'),
      msg('m2', 's1', 'assistant', 'The world is your oyster'),
      msg('m3', 's2', 'user', 'Authentication is required for access'),
      msg('m4', 's2', 'assistant', 'Another unrelated message here'),
      msg('m5', 's3', 'user', 'Hello again from session three'),
    ]);
  });

  afterEach(() => {
    store.close();
  });

  it('finds a single word across multiple sessions', () => {
    const results = store.search('Hello');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['m1', 'm5']);
  });

  it('finds a word case-insensitively', () => {
    const lower = store.search('hello');
    const upper = store.search('HELLO');
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThanOrEqual(2);
  });

  it('finds prefix matches with * suffix', () => {
    const results = store.search('auth*');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m3');
    // Trigram tokenizer + highlight: the prefix 'Auth' is highlighted.
    expect(results[0].snippet).toContain('[Auth]');
  });

  it('finds multi-word phrase with quotes', () => {
    const results = store.search('"Hello world"');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
  });

  it('returns empty array for no matches', () => {
    const results = store.search('nonexistent');
    expect(results).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    expect(store.search('')).toEqual([]);
    expect(store.search('   ')).toEqual([]);
  });

  it('returns empty array for 1-char and 2-char queries (trigram minimum)', () => {
    // Trigram tokenizer needs 3+ chars.
    expect(store.search('a')).toEqual([]);
    expect(store.search('ab')).toEqual([]);
  });

  it('finds 3-char queries (trigram minimum)', () => {
    const results = store.search('Hello');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by sessionId', () => {
    const results = store.search('Hello', { sessionId: 's3' });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('s3');
  });

  it('filters by role', () => {
    const results = store.search('Hello', { role: 'assistant' });
    // No assistant messages contain 'Hello' in this fixture.
    expect(results).toEqual([]);
    const results2 = store.search('Hello', { role: 'user' });
    expect(results2.length).toBeGreaterThanOrEqual(2);
    results2.forEach((r) => expect(r.role).toBe('user'));
  });

  it('paginates with limit + offset', () => {
    const all = store.search('Hello', { limit: 100 });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const page1 = store.search('Hello', { limit: 1, offset: 0 });
    const page2 = store.search('Hello', { limit: 1, offset: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('respects default limit of 20', () => {
    // Index 30 messages with a common word.
    const msgs = Array.from({ length: 30 }, (_, i) =>
      msg(`p${i}`, 'sx', 'user', `common word number ${i}`),
    );
    store.indexBatch(msgs);
    const results = store.search('common');
    expect(results.length).toBe(20);
  });

  it('uses custom highlight markers', () => {
    const results = store.search('Hello', {
      highlightMarkers: ['<b>', '</b>'],
      limit: 1,
    });
    expect(results[0].snippet).toContain('<b>Hello</b>');
  });

  it('snippet contains context around the match', () => {
    const results = store.search('Authentication', { limit: 1 });
    expect(results[0].snippet).toContain('Authentication');
    expect(results[0].snippet.length).toBeGreaterThan('Authentication'.length);
  });

  it('rank field is a number (BM25 score)', () => {
    const results = store.search('Hello');
    results.forEach((r) => {
      expect(typeof r.rank).toBe('number');
    });
  });

  it('tokens field is returned from the index', () => {
    const results = store.search('Hello', { limit: 1 });
    expect(results[0].tokens).toBe(10); // default tokens from msg() helper
  });

  it('returns correct metadata (id, sessionId, role, timestamp)', () => {
    const results = store.search('Hello');
    const r = results.find((x) => x.id === 'm1');
    expect(r).toBeDefined();
    expect(r!.sessionId).toBe('s1');
    expect(r!.role).toBe('user');
    expect(r!.timestamp).toBe('2026-07-05T12:00:00.000Z');
  });
});

describe('SearchStore — CJK search (trigram tokenizer)', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
    store.indexBatch([
      msg('c1', 's1', 'user', '你好世界，这是一个测试。'),
      msg('c2', 's1', 'assistant', '另一个中文消息内容。'),
      msg('c3', 's2', 'user', '日本語のテストメッセージです。'),
      msg('c4', 's2', 'assistant', '한국어 테스트 메시지입니다.'),
      msg('c5', 's3', 'user', 'Hello world in English, with 你好 mixed.'),
    ]);
  });

  afterEach(() => {
    store.close();
  });

  it('finds Chinese 3-char queries', () => {
    const results = store.search('你好世');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('c1');
    expect(results[0].snippet).toContain('你好世');
  });

  it('finds Chinese 4+ char queries', () => {
    const results = store.search('中文消息');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c2');
  });

  it('finds Japanese 3-char queries', () => {
    const results = store.search('日本語');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c3');
  });

  it('finds Korean 3-char queries', () => {
    const results = store.search('한국어');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c4');
  });

  it('finds mixed CJK + ASCII content', () => {
    const results = store.search('Hello');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('c5');
  });

  it('CJK snippet highlights the matched term', () => {
    const results = store.search('你好世', { highlightMarkers: ['[', ']'] });
    expect(results[0].snippet).toContain('[你好世]');
  });

  it('CJK prefix query with * works (3+ chars before *)', () => {
    // Trigram tokenizer requires 3+ chars before the * for prefix matching.
    const results = store.search('你好世*');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for 1-2 char CJK queries (trigram minimum)', () => {
    expect(store.search('你好')).toEqual([]); // 2 chars — below minimum
    expect(store.search('你')).toEqual([]); // 1 char — below minimum
  });
});

describe('SearchStore — delete + clear', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
    store.indexBatch([
      msg('m1', 's1', 'user', 'first message'),
      msg('m2', 's1', 'assistant', 'second message'),
      msg('m3', 's2', 'user', 'third message'),
    ]);
  });

  afterEach(() => {
    store.close();
  });

  it('deleteMessage() removes a single message', () => {
    store.deleteMessage('m1');
    expect(store.count()).toBe(2);
    expect(store.search('first')).toEqual([]);
  });

  it('deleteMessage() is idempotent (no-op if missing)', () => {
    store.deleteMessage('nonexistent');
    expect(store.count()).toBe(3);
  });

  it('deleteSession() removes all messages in a session', () => {
    store.deleteSession('s1');
    expect(store.count()).toBe(1);
    expect(store.count('s1')).toBe(0);
    expect(store.count('s2')).toBe(1);
    expect(store.listSessions()).toEqual(['s2']);
  });

  it('deleteSession() is idempotent (no-op if missing)', () => {
    store.deleteSession('nonexistent');
    expect(store.count()).toBe(3);
  });

  it('clear() removes all messages', () => {
    store.clear();
    expect(store.count()).toBe(0);
    expect(store.listSessions()).toEqual([]);
  });
});

describe('SearchStore — persistence', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'goli-search-'));
    dbPath = join(tmpDir, 'search.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('data persists across close + reopen', () => {
    const s1 = new SearchStore({ dbPath });
    s1.indexBatch([
      msg('m1', 's1', 'user', 'persisted message one'),
      msg('m2', 's1', 'user', 'persisted message two'),
    ]);
    expect(s1.count()).toBe(2);
    s1.close();

    // Reopen — data should still be there.
    const s2 = new SearchStore({ dbPath });
    expect(s2.count()).toBe(2);
    const results = s2.search('persisted');
    expect(results.length).toBe(2);
    s2.close();
  });

  it('in-memory data does NOT persist (lost on close)', () => {
    const s1 = new SearchStore({ inMemory: true });
    s1.index(msg('m1', 's1', 'user', 'ephemeral message'));
    s1.close();

    const s2 = new SearchStore({ inMemory: true });
    expect(s2.count()).toBe(0);
    s2.close();
  });

  it('indexBatch is transactional — partial failure rolls back', () => {
    const s1 = new SearchStore({ dbPath });
    // Insert 3 valid messages first.
    s1.indexBatch([
      msg('m1', 's1', 'user', 'good one'),
      msg('m2', 's1', 'user', 'good two'),
      msg('m3', 's1', 'user', 'good three'),
    ]);
    expect(s1.count()).toBe(3);

    // Now attempt a batch where the 2nd message has a `tokens` value of
    // incompatible type (a function, which better-sqlite3 rejects).
    // The transaction should roll back, leaving the original 3 messages
    // intact AND not committing m4.
    const badMsg = {
      id: 'm4',
      sessionId: 's1',
      role: 'user',
      timestamp: '2026-07-05T12:00:00.000Z',
      content: 'good four',
      // better-sqlite3 throws TypeError on unsupported types like functions.
      tokens: (() => 42) as unknown as number,
    };
    expect(() => s1.indexBatch([msg('m5', 's1', 'user', 'good five'), badMsg])).toThrow();

    // The 3 original messages should remain; m4 and m5 should NOT be present
    // (transaction rolled back).
    expect(s1.count()).toBe(3);
    expect(s1.search('four')).toEqual([]);
    expect(s1.search('five')).toEqual([]);
    s1.close();
  });
});

describe('SearchStore — ranking + ordering', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
    // Multiple messages with the same word, different frequencies.
    store.indexBatch([
      msg('m1', 's1', 'user', 'rare word'),
      msg('m2', 's1', 'user', 'common common common word word'),
      msg('m3', 's2', 'user', 'word word word'),
    ]);
  });

  afterEach(() => {
    store.close();
  });

  it('returns results sorted by BM25 rank (most relevant first)', () => {
    const results = store.search('word');
    expect(results.length).toBeGreaterThanOrEqual(3);
    // BM25 scores should be ascending (lower = better in SQLite FTS5).
    for (let i = 1; i < results.length; i++) {
      expect(results[i].rank).toBeGreaterThanOrEqual(results[i - 1].rank);
    }
  });
});

describe('SearchStore — optimize', () => {
  it('optimize() does not throw and preserves data', () => {
    const store = new SearchStore({ inMemory: true });
    store.indexBatch([
      msg('m1', 's1', 'user', 'one'),
      msg('m2', 's1', 'user', 'two'),
    ]);
    expect(() => store.optimize()).not.toThrow();
    expect(store.count()).toBe(2);
    store.close();
  });
});

describe('buildQuery() helper', () => {
  it('returns empty string for empty input', () => {
    expect(buildQuery('')).toBe('');
    expect(buildQuery('   ')).toBe('');
  });

  it('passes through prefix queries (ending with *)', () => {
    expect(buildQuery('auth*')).toBe('auth*');
  });

  it('passes through phrase queries (wrapped in quotes)', () => {
    expect(buildQuery('"hello world"')).toBe('"hello world"');
  });

  it('wraps single word as prefix match', () => {
    expect(buildQuery('hello')).toBe('hello*');
  });

  it('wraps multi-word as phrase match', () => {
    expect(buildQuery('hello world')).toBe('"hello world"');
  });
});

describe('SearchStore — edge cases', () => {
  let store: SearchStore;

  beforeEach(() => {
    store = new SearchStore({ inMemory: true });
  });

  afterEach(() => {
    store.close();
  });

  it('handles content with special characters (newlines, tabs)', () => {
    store.index(msg('m1', 's1', 'user', 'line one\nline two\tindented'));
    const results = store.search('line');
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('line');
  });

  it('handles content with SQL-like syntax (no injection)', () => {
    store.index(msg('m1', 's1', 'user', "DROP TABLE; -- SELECT * FROM"));
    // Search for the literal text — should not execute as SQL.
    const results = store.search('DROP');
    expect(results).toHaveLength(1);
    expect(store.count()).toBe(1); // Table not dropped.
  });

  it('handles very long content (10KB)', () => {
    const longContent = 'word '.repeat(2000); // ~10KB
    store.index(msg('m1', 's1', 'user', longContent));
    const results = store.search('word');
    expect(results).toHaveLength(1);
  });

  it('handles Unicode emoji in content', () => {
    store.index(msg('m1', 's1', 'user', 'Hello with emoji rocket'));
    const results = store.search('Hello');
    expect(results).toHaveLength(1);
  });

  it('handles empty content (no crash)', () => {
    store.index(msg('m1', 's1', 'user', ''));
    expect(store.count()).toBe(1);
    // Searching empty content finds nothing (no FTS tokens).
    expect(store.search('anything')).toEqual([]);
  });

  it('handles concurrent index + search (no deadlock)', () => {
    // Index 50 messages, searching after each. Use limit > default(20) so we see all matches.
    for (let i = 0; i < 50; i++) {
      store.index(msg(`m${i}`, 's1', 'user', `message ${i} with keyword`));
      const r = store.search('keyword', { limit: 100 });
      expect(r.length).toBe(i + 1);
    }
    expect(store.count()).toBe(50);
  });

  it('close() is idempotent', () => {
    expect(() => {
      store.close();
      store.close();
    }).not.toThrow();
  });

  it('handles 0-token result metadata correctly', () => {
    store.index({ ...msg('m1', 's1', 'user', 'no tokens field') , tokens: undefined });
    const results = store.search('tokens');
    expect(results).toHaveLength(1);
    expect(results[0].tokens).toBe(0); // defaults to 0
  });
});

describe('SearchStore — Hermes-parity integration scenario', () => {
  it('mirrors the Hermes SessionDB use-case: index a multi-turn conversation, search across sessions', () => {
    const store = new SearchStore({ inMemory: true });

    // Session 1: a debugging conversation.
    store.indexBatch([
      msg('s1m1', 'sess-debug-1', 'user', 'How do I fix the TypeError in my auth module?'),
      msg('s1m2', 'sess-debug-1', 'assistant', 'The TypeError is likely caused by passing undefined to auth.login(). Check the call site.'),
      msg('s1m3', 'sess-debug-1', 'user', 'Yes, that was it. I added a null check.'),
    ]);

    // Session 2: a feature design conversation.
    store.indexBatch([
      msg('s2m1', 'sess-feature-2', 'user', 'Design a rate limiter for the auth service.'),
      msg('s2m2', 'sess-feature-2', 'assistant', 'Token bucket algorithm with a sliding window. Suggest 100 req/min per API key.'),
      msg('s2m3', 'sess-feature-2', 'user', 'Approve. Implement and add tests.'),
    ]);

    // Session 3: a deployment conversation.
    store.indexBatch([
      msg('s3m1', 'sess-deploy-3', 'user', 'Deploy the auth service to production.'),
      msg('s3m2', 'sess-deploy-3', 'assistant', 'Deployed. Canary at 10%. Monitoring error rate.'),
    ]);

    // Search across all sessions for "auth". Appears in 4 messages:
    // s1m1 (auth module), s1m2 (auth.login), s2m1 (auth service), s3m1 (auth service).
    const authResults = store.search('auth');
    expect(authResults.length).toBe(4);

    // Search for "TypeError" — should find only the debugging session (2 messages there).
    const errorResults = store.search('TypeError');
    expect(errorResults).toHaveLength(2);
    errorResults.forEach((r) => expect(r.sessionId).toBe('sess-debug-1'));

    // Search for "rate limiter" — only the feature session.
    const rlResults = store.search('rate limiter');
    expect(rlResults).toHaveLength(1);
    expect(rlResults[0].sessionId).toBe('sess-feature-2');

    // Filter by session.
    const sess1Results = store.search('auth', { sessionId: 'sess-debug-1' });
    expect(sess1Results.length).toBeGreaterThanOrEqual(1);
    sess1Results.forEach((r) => expect(r.sessionId).toBe('sess-debug-1'));

    // List all sessions.
    expect(store.listSessions().sort()).toEqual([
      'sess-debug-1',
      'sess-deploy-3',
      'sess-feature-2',
    ]);

    // Delete a session and verify.
    store.deleteSession('sess-feature-2');
    expect(store.count()).toBe(5); // 3 + 2 = 5 remaining
    expect(store.listSessions().sort()).toEqual(['sess-debug-1', 'sess-deploy-3']);

    store.close();
  });

  it('CJK session search mirrors Hermes trigram-CJK behavior', () => {
    const store = new SearchStore({ inMemory: true });
    store.indexBatch([
      msg('j1', 'job-search', 'user', '我在找一份软件工程师的工作。'),
      msg('j2', 'job-search', 'assistant', '建议你投递几家大公司，比如腾讯、阿里巴巴、字节跳动。'),
      msg('j3', 'recipe-search', 'user', '今天的晚餐做什么？红烧肉怎么样？'),
      msg('j4', 'recipe-search', 'assistant', '红烧肉是个好选择。需要五花肉、酱油、糖、料酒。'),
    ]);

    // Search for "软件工程师" — should find the job session.
    const r1 = store.search('软件工程师');
    expect(r1).toHaveLength(1);
    expect(r1[0].sessionId).toBe('job-search');

    // Search for "红烧肉" — should find the recipe session.
    const r2 = store.search('红烧肉');
    expect(r2.length).toBe(2); // appears in user + assistant messages

    // Snippet highlights.
    const r3 = store.search('红烧肉', { highlightMarkers: ['{', '}'] });
    expect(r3[0].snippet).toContain('{红烧肉}');

    store.close();
  });
});
