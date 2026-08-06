/**
 * Unit tests for H16: JSONL Session Store with resume and branching.
 *
 * Verifies:
 *   - createSession writes metadata + empty JSONL
 *   - appendMessage adds lines to the JSONL file
 *   - resume loads metadata + messages
 *   - branch creates a new session with parentId and (optionally truncated) messages
 *   - listSessions returns all sessions sorted by updatedAt desc
 *   - deleteSession removes both files
 *   - updateMetadata merges updates
 *   - corrupted JSONL lines are skipped (not fatal)
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { JsonlSessionStore } from '../../packages/memory-engine/src/session/jsonl-store.js';

import type { Message } from '../../packages/core/src/agent/types.js';

function makeMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

describe('H16 JsonlSessionStore', () => {
  let sessionsDir: string;
  let store: JsonlSessionStore;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'goli-h16-sessions-'));
    store = new JsonlSessionStore({ sessionsDir });
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('creates a session with metadata and empty JSONL', () => {
    const meta = store.createSession({
      prompt: 'Fix the bug in parser.ts',
      role: 'orchestrator',
      workspaceRoot: '/tmp/repo',
      branch: 'main',
    });
    expect(meta.id).toBeDefined();
    expect(meta.prompt).toBe('Fix the bug in parser.ts');
    expect(meta.role).toBe('orchestrator');
    expect(meta.messageCount).toBe(0);
    expect(meta.totalTokens).toBe(0);
    expect(meta.tags).toEqual([]);
    expect(existsSync(join(sessionsDir, `${meta.id}.meta.json`))).toBe(true);
    expect(existsSync(join(sessionsDir, `${meta.id}.jsonl`))).toBe(true);
  });

  it('appends messages and updates messageCount', () => {
    const meta = store.createSession({
      prompt: 'test',
      role: 'orchestrator',
      workspaceRoot: '/tmp/repo',
    });
    store.appendMessage(meta.id, makeMessage('user', 'hello'));
    store.appendMessage(meta.id, makeMessage('assistant', 'hi there'));
    const jsonl = readFileSync(join(sessionsDir, `${meta.id}.jsonl`), 'utf-8');
    expect(jsonl.trim().split('\n')).toHaveLength(2);
    // Re-read metadata to confirm messageCount was updated
    const loaded = store.resume(meta.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.messageCount).toBe(2);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0]!.content).toBe('hello');
    expect(loaded!.messages[1]!.content).toBe('hi there');
  });

  it('resume returns null for unknown session', () => {
    expect(store.resume('nonexistent-id')).toBeNull();
  });

  it('branch creates a child session with parentId', () => {
    const parent = store.createSession({
      prompt: 'original task',
      role: 'orchestrator',
      workspaceRoot: '/tmp/repo',
    });
    store.appendMessage(parent.id, makeMessage('user', 'msg1'));
    store.appendMessage(parent.id, makeMessage('assistant', 'reply1'));
    store.appendMessage(parent.id, makeMessage('user', 'msg2'));

    const child = store.branch(parent.id);
    expect(child.id).not.toBe(parent.id);
    expect(child.parentId).toBe(parent.id);
    expect(child.prompt).toBe('original task');
    // Child should have all 3 messages from the parent
    const loaded = store.resume(child.id);
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[2]!.content).toBe('msg2');
    // Tags should include 'branched'
    expect(loaded!.metadata.tags).toContain('branched');
  });

  it('branch with branchPoint truncates the transcript', () => {
    const parent = store.createSession({
      prompt: 'task',
      role: 'orchestrator',
      workspaceRoot: '/tmp/repo',
    });
    store.appendMessage(parent.id, makeMessage('user', 'msg1'));
    store.appendMessage(parent.id, makeMessage('assistant', 'reply1'));
    store.appendMessage(parent.id, makeMessage('user', 'msg2'));
    store.appendMessage(parent.id, makeMessage('assistant', 'reply2'));

    // Branch at index 2 — child should have only msg1 + reply1
    const child = store.branch(parent.id, 2);
    const loaded = store.resume(child.id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0]!.content).toBe('msg1');
    expect(loaded!.messages[1]!.content).toBe('reply1');
  });

  it('branch throws for unknown session', () => {
    expect(() => store.branch('nonexistent')).toThrow('session not found');
  });

  it('listSessions returns all sessions sorted by updatedAt desc', async () => {
    const meta1 = store.createSession({ prompt: 'first', role: 'orchestrator', workspaceRoot: '/tmp' });
    // Wait a bit so updatedAt differs
    await new Promise((r) => setTimeout(r, 10));
    const meta2 = store.createSession({ prompt: 'second', role: 'orchestrator', workspaceRoot: '/tmp' });
    await new Promise((r) => setTimeout(r, 10));
    // Touch meta1 to make it more recent
    store.updateMetadata(meta1.id, { totalTokens: 100 });

    const list = store.listSessions();
    expect(list).toHaveLength(2);
    // meta1 was updated last → should be first
    expect(list[0]!.id).toBe(meta1.id);
    expect(list[1]!.id).toBe(meta2.id);
  });

  it('listSessions skips corrupted metadata files', () => {
    store.createSession({ prompt: 'good', role: 'orchestrator', workspaceRoot: '/tmp' });
    // Write a corrupted metadata file
    writeFileSync(join(sessionsDir, 'corrupted.meta.json'), '{not valid json', 'utf-8');
    const list = store.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.prompt).toBe('good');
  });

  it('updateMetadata merges updates', () => {
    const meta = store.createSession({ prompt: 'test', role: 'orchestrator', workspaceRoot: '/tmp' });
    store.updateMetadata(meta.id, { totalTokens: 500, iterations: 3, tags: ['important'] });
    const loaded = store.resume(meta.id);
    expect(loaded!.metadata.totalTokens).toBe(500);
    expect(loaded!.metadata.iterations).toBe(3);
    expect(loaded!.metadata.tags).toEqual(['important']);
  });

  it('updateMetadata throws for unknown session', () => {
    expect(() => store.updateMetadata('nonexistent', { totalTokens: 1 })).toThrow('Session not found');
  });

  it('deleteSession removes both files', () => {
    const meta = store.createSession({ prompt: 'test', role: 'orchestrator', workspaceRoot: '/tmp' });
    store.appendMessage(meta.id, makeMessage('user', 'hello'));
    expect(store.deleteSession(meta.id)).toBe(true);
    expect(existsSync(join(sessionsDir, `${meta.id}.meta.json`))).toBe(false);
    expect(existsSync(join(sessionsDir, `${meta.id}.jsonl`))).toBe(false);
    expect(store.resume(meta.id)).toBeNull();
  });

  it('deleteSession returns false for unknown session', () => {
    expect(store.deleteSession('nonexistent')).toBe(false);
  });

  it('skips corrupted JSONL lines when reading messages', () => {
    const meta = store.createSession({ prompt: 'test', role: 'orchestrator', workspaceRoot: '/tmp' });
    store.appendMessage(meta.id, makeMessage('user', 'good1'));
    // Append a corrupted line directly to the file
    const path = join(sessionsDir, `${meta.id}.jsonl`);
    writeFileSync(path, readFileSync(path, 'utf-8') + '{not valid json\n', 'utf-8');
    store.appendMessage(meta.id, makeMessage('user', 'good2'));
    const loaded = store.resume(meta.id);
    // Should have 2 good messages (corrupted line skipped)
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0]!.content).toBe('good1');
    expect(loaded!.messages[1]!.content).toBe('good2');
  });
});
