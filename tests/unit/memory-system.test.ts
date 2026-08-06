/**
 * Unit tests for session memory, external plugin, and curator.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { MemoryCurator } from '../../packages/memory-engine/src/curator/agent.js';
import { VectorMemoryPlugin } from '../../packages/memory-engine/src/external/vector-plugin.js';
import { PersistentMemory } from '../../packages/memory-engine/src/persistent/files.js';
import { SessionMemory } from '../../packages/memory-engine/src/session/ephemeral.js';

import type { SessionMemoryEntry } from '../../packages/memory-engine/src/types.js';

let testDir: string;
let projectDir: string;
let persistent: PersistentMemory;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-mem-test-'));
  projectDir = mkdtempSync(join(tmpdir(), 'goli-proj-test-'));
  persistent = new PersistentMemory({ memoriesDir: testDir, projectRoot: projectDir });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe('SessionMemory', () => {
  it('records and retrieves entries', () => {
    const mem = new SessionMemory();
    const entry = mem.record('User prefers TypeScript', 'preference');
    expect(entry.content).toBe('User prefers TypeScript');
    expect(entry.category).toBe('preference');
    expect(mem.count).toBe(1);
    expect(mem.getAll()).toHaveLength(1);
  });

  it('filters by category', () => {
    const mem = new SessionMemory();
    mem.record('Fact 1', 'fact');
    mem.record('Pref 1', 'preference');
    mem.record('Fact 2', 'fact');

    expect(mem.getByCategory('fact')).toHaveLength(2);
    expect(mem.getByCategory('preference')).toHaveLength(1);
  });

  it('getRecent returns last N entries', () => {
    const mem = new SessionMemory();
    mem.record('A', 'fact');
    mem.record('B', 'fact');
    mem.record('C', 'fact');

    const recent = mem.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.content).toBe('B');
    expect(recent[1]!.content).toBe('C');
  });

  it('search by keyword', () => {
    const mem = new SessionMemory();
    mem.record('The auth module uses JWT', 'fact');
    mem.record('User prefers dark mode', 'preference');

    const results = mem.search('auth');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('auth');
  });

  it('clear empties all entries', () => {
    const mem = new SessionMemory();
    mem.record('A', 'fact');
    mem.record('B', 'fact');
    mem.clear();
    expect(mem.count).toBe(0);
  });

  it('summarize groups by category', () => {
    const mem = new SessionMemory();
    mem.record('Fact 1', 'fact');
    mem.record('Pref 1', 'preference');
    const summary = mem.summarize();
    expect(summary).toContain('fact');
    expect(summary).toContain('preference');
    expect(summary).toContain('Fact 1');
    expect(summary).toContain('Pref 1');
  });
});

describe('VectorMemoryPlugin', () => {
  it('searches session memory by keyword', async () => {
    const session = new SessionMemory();
    session.record('The parser handles JSON repair', 'fact');
    session.record('User likes concise responses', 'preference');

    const plugin = new VectorMemoryPlugin({ sessionMemory: session });
    const results = await plugin.search('parser', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain('parser');
  });

  it('adds and searches locally-added entries', async () => {
    const plugin = new VectorMemoryPlugin();
    await plugin.add('The config uses TOML format');
    await plugin.add('Tests run with vitest');

    const results = await plugin.search('config', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain('config');
  });

  it('returns empty for no matches', async () => {
    const session = new SessionMemory();
    session.record('Some content', 'fact');
    const plugin = new VectorMemoryPlugin({ sessionMemory: session });
    const results = await plugin.search('nonexistent_xyz');
    expect(results).toHaveLength(0);
  });

  it('respects topK limit', async () => {
    const plugin = new VectorMemoryPlugin();
    await plugin.add('memory entry one');
    await plugin.add('memory entry two');
    await plugin.add('memory entry three');

    const results = await plugin.search('memory', 2);
    expect(results).toHaveLength(2);
  });

  it('tracks entry count', async () => {
    const plugin = new VectorMemoryPlugin();
    expect(plugin.count).toBe(0);
    await plugin.add('entry 1');
    expect(plugin.count).toBe(1);
    await plugin.add('entry 2');
    expect(plugin.count).toBe(2);
  });
});

describe('MemoryCurator', () => {
  it('returns empty result for no entries', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    const result = await curator.curate([]);
    expect(result.curated).toBe(0);
    expect(result.written).toBe(0);
  });

  it('classifies preferences to USER.md', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    const entries: SessionMemoryEntry[] = [
      {
        id: '1', content: 'User prefers functional style', category: 'preference',
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await curator.curate(entries);
    expect(result.written).toBe(1);
    expect(result.files.user).toBe(1);
    expect(result.files.memory).toBe(0);

    const userFile = persistent.load('USER.md');
    expect(userFile.content).toContain('User prefers functional style');
  });

  it('classifies project facts to PROJECT.md', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    const entries: SessionMemoryEntry[] = [
      {
        id: '1', content: 'This repo uses src/ directory structure', category: 'fact',
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await curator.curate(entries);
    expect(result.files.project).toBe(1);

    const projectFile = persistent.load('PROJECT.md');
    expect(projectFile.content).toContain('src/ directory');
  });

  it('classifies general learnings to MEMORY.md', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    const entries: SessionMemoryEntry[] = [
      {
        id: '1', content: 'TypeScript strict mode catches more bugs', category: 'learning',
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await curator.curate(entries);
    expect(result.files.memory).toBe(1);

    const memoryFile = persistent.load('MEMORY.md');
    expect(memoryFile.content).toContain('TypeScript strict mode');
  });

  it('deduplicates against existing content', async () => {
    // Pre-populate MEMORY.md
    persistent.save('MEMORY.md', '## Session Learnings\n- [learning] TypeScript strict mode catches more bugs');

    const curator = new MemoryCurator({ persistentMemory: persistent });
    const entries: SessionMemoryEntry[] = [
      {
        id: '1', content: 'TypeScript strict mode catches more bugs', category: 'learning',
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await curator.curate(entries);
    // Should be deduplicated (0 written)
    expect(result.written).toBe(0);
  });

  it('writes multiple entries across files', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    const entries: SessionMemoryEntry[] = [
      { id: '1', content: 'Prefers dark theme', category: 'preference', timestamp: new Date().toISOString() },
      { id: '2', content: 'This repo uses pnpm', category: 'fact', timestamp: new Date().toISOString() },
      { id: '3', content: 'Always run tests before commit', category: 'learning', timestamp: new Date().toISOString() },
    ];

    const result = await curator.curate(entries);
    expect(result.curated).toBe(3);
    expect(result.written).toBe(3);
    expect(result.files.user).toBe(1);
    expect(result.files.project).toBe(1);
    expect(result.files.memory).toBe(1);
  });

  it('enforces budget when writing', async () => {
    const curator = new MemoryCurator({ persistentMemory: persistent });
    // Create a very long entry
    const longContent = 'x'.repeat(3000);
    const entries: SessionMemoryEntry[] = [
      { id: '1', content: longContent, category: 'learning', timestamp: new Date().toISOString() },
    ];

    await curator.curate(entries);
    const memoryFile = persistent.load('MEMORY.md');
    expect(memoryFile.length).toBeLessThanOrEqual(memoryFile.budget);
  });
});
