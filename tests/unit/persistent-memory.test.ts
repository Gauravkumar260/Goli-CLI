/**
 * Unit tests for the persistent memory system.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PersistentMemory } from '../../packages/memory-engine/src/persistent/files.js';
import { MEMORY_BUDGETS } from '../../packages/memory-engine/src/types.js';

let testDir: string;
let projectDir: string;
let memory: PersistentMemory;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-memory-test-'));
  projectDir = mkdtempSync(join(tmpdir(), 'goli-project-test-'));
  memory = new PersistentMemory({ memoriesDir: testDir, projectRoot: projectDir });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe('PersistentMemory', () => {
  it('returns empty content for non-existent files', () => {
    const file = memory.load('MEMORY.md');
    expect(file.content).toBe('');
    expect(file.length).toBe(0);
    expect(file.overBudget).toBe(false);
  });

  it('saves and loads content', () => {
    memory.save('MEMORY.md', 'This is a memory entry.');
    const file = memory.load('MEMORY.md');
    expect(file.content).toBe('This is a memory entry.');
    expect(file.length).toBe('This is a memory entry.'.length);
  });

  it('enforces character budget on save', () => {
    const longContent = 'x'.repeat(MEMORY_BUDGETS.MEMORY + 1000);
    const file = memory.save('MEMORY.md', longContent);
    expect(file.length).toBeLessThanOrEqual(MEMORY_BUDGETS.MEMORY);
    expect(file.content).toContain('[... truncated ...]');
    expect(file.overBudget).toBe(false);
  });

  it('appends to existing content', () => {
    memory.save('MEMORY.md', 'First entry.');
    memory.append('MEMORY.md', 'Second entry.');
    const file = memory.load('MEMORY.md');
    expect(file.content).toContain('First entry.');
    expect(file.content).toContain('Second entry.');
  });

  it('PROJECT.md is stored in the project root', () => {
    memory.save('PROJECT.md', 'Project info.');
    const filePath = join(projectDir, 'PROJECT.md');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('Project info.');
  });

  it('MEMORY.md and USER.md are stored in the memories dir', () => {
    memory.save('MEMORY.md', 'Memory.');
    memory.save('USER.md', 'User prefs.');
    expect(existsSync(join(testDir, 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(testDir, 'USER.md'))).toBe(true);
  });

  it('takeSnapshot captures all three files', () => {
    memory.save('MEMORY.md', 'Memory content.');
    memory.save('USER.md', 'User content.');
    memory.save('PROJECT.md', 'Project content.');

    const snapshot = memory.takeSnapshot();
    expect(snapshot.memory).toBe('Memory content.');
    expect(snapshot.user).toBe('User content.');
    expect(snapshot.project).toBe('Project content.');
    expect(snapshot.snapshotTime).toBeDefined();
    expect(snapshot.counts.memory).toBe('Memory content.'.length);
    expect(snapshot.counts.user).toBe('User content.'.length);
    expect(snapshot.counts.project).toBe('Project content.'.length);
    expect(snapshot.counts.total).toBe(
      'Memory content.'.length + 'User content.'.length + 'Project content.'.length,
    );
  });

  it('takeSnapshot returns undefined for empty files', () => {
    const snapshot = memory.takeSnapshot();
    expect(snapshot.memory).toBeUndefined();
    expect(snapshot.user).toBeUndefined();
    expect(snapshot.project).toBeUndefined();
    expect(snapshot.counts.total).toBe(0);
  });

  it('checkBudgets detects over-budget files', () => {
    const overContent = 'x'.repeat(MEMORY_BUDGETS.USER + 100);
    // Write directly (bypassing save's truncation)
    writeFileSync(join(testDir, 'USER.md'), overContent);

    const result = memory.checkBudgets();
    expect(result.user).toBe(true);
    expect(result.any).toBe(true);
  });

  it('getUsageRatio returns 0 for empty memory', () => {
    expect(memory.getUsageRatio()).toBe(0);
  });

  it('getUsageRatio increases with content', () => {
    memory.save('MEMORY.md', 'x'.repeat(220)); // 220 chars
    const ratio = memory.getUsageRatio();
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('clear empties a file', () => {
    memory.save('MEMORY.md', 'Some content.');
    memory.clear('MEMORY.md');
    const file = memory.load('MEMORY.md');
    expect(file.content).toBe('');
  });

  it('loadAll returns all three files', () => {
    memory.save('MEMORY.md', 'M');
    memory.save('USER.md', 'U');
    memory.save('PROJECT.md', 'P');

    const all = memory.loadAll();
    expect(all.memory.content).toBe('M');
    expect(all.user.content).toBe('U');
    expect(all.project.content).toBe('P');
  });
});
