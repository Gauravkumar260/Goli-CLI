/**
 * Tests for T-082: @ file-path Tab completion.
 *
 * Covers:
 *   - getFileCompletions() returns entries for empty partial (cwd listing)
 *   - getFileCompletions() filters by prefix
 *   - getFileCompletions() lists directory contents when partial ends with /
 *   - getFileCompletions() sorts directories first
 *   - getFileCompletions() caps at MAX_FILE_COMPLETIONS
 *   - getFileCompletions() returns empty for nonexistent directory
 *   - getFileCompletions() marks directories with isDirectory=true
 *   - FileCompletion.label has trailing / for directories
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getFileCompletions, MAX_FILE_COMPLETIONS, type FileCompletion } from '../../apps/cli/src/tui/lib/fileCompletion.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-filecomp-'));
  // Create a known structure:
  //   testDir/
  //     src/
  //       index.ts
  //       helper.ts
  //     package.json
  //     README.md
  mkdirSync(join(testDir, 'src'));
  writeFileSync(join(testDir, 'src', 'index.ts'), 'export {}');
  writeFileSync(join(testDir, 'src', 'helper.ts'), 'export {}');
  writeFileSync(join(testDir, 'package.json'), '{}');
  writeFileSync(join(testDir, 'README.md'), '# Test');
});

// ─── getFileCompletions() ───────────────────────────────────────────

describe('T-082: getFileCompletions()', () => {
  it('returns cwd entries for empty partial', () => {
    const results = getFileCompletions('', testDir);
    expect(results.length).toBeGreaterThan(0);
    // Should include package.json, README.md, and src/
    const labels = results.map((r) => r.label);
    expect(labels).toContain('package.json');
    expect(labels).toContain('README.md');
    expect(labels).toContain('src/');
  });

  it('filters by prefix', () => {
    const results = getFileCompletions('pac', testDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe('package.json');
  });

  it('lists directory contents when partial ends with /', () => {
    const results = getFileCompletions('src/', testDir);
    expect(results.length).toBe(2);
    const labels = results.map((r) => r.label);
    expect(labels).toContain('index.ts');
    expect(labels).toContain('helper.ts');
  });

  it('filters directory contents by prefix', () => {
    const results = getFileCompletions('src/ind', testDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe('index.ts');
  });

  it('sorts directories first', () => {
    // Create a file that sorts before 'src' alphabetically but should
    // appear AFTER src/ because src/ is a directory.
    writeFileSync(join(testDir, 'aaa-file.txt'), 'aaa');
    const results = getFileCompletions('', testDir);
    const firstDirIdx = results.findIndex((r) => r.isDirectory);
    const firstFileIdx = results.findIndex((r) => !r.isDirectory);
    expect(firstDirIdx).toBeLessThanOrEqual(firstFileIdx);
    // All directories should come before all files
    for (let i = 0; i < results.length; i++) {
      if (!results[i]!.isDirectory) {
        for (let j = i + 1; j < results.length; j++) {
          expect(results[j]!.isDirectory).toBe(false);
        }
        break;
      }
    }
  });

  it('marks directories with isDirectory=true and label has trailing /', () => {
    const results = getFileCompletions('', testDir);
    const src = results.find((r) => r.value === 'src');
    expect(src).toBeDefined();
    expect(src!.isDirectory).toBe(true);
    expect(src!.label).toBe('src/');
  });

  it('marks files with isDirectory=false', () => {
    const results = getFileCompletions('package', testDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.isDirectory).toBe(false);
    expect(results[0]!.label).toBe('package.json');
  });

  it('returns empty array for nonexistent directory', () => {
    const results = getFileCompletions('nonexistent/', testDir);
    expect(results).toEqual([]);
  });

  it('returns empty array for nonexistent prefix', () => {
    const results = getFileCompletions('xyz_nonexistent', testDir);
    expect(results).toEqual([]);
  });

  it('caps at MAX_FILE_COMPLETIONS', () => {
    // Create many files
    for (let i = 0; i < MAX_FILE_COMPLETIONS + 5; i++) {
      writeFileSync(join(testDir, `file-${i}.txt`), '');
    }
    const results = getFileCompletions('file-', testDir);
    expect(results.length).toBeLessThanOrEqual(MAX_FILE_COMPLETIONS);
  });

  it('returns relative path in value field', () => {
    const results = getFileCompletions('src/ind', testDir);
    expect(results[0]!.value).toBe('src/index.ts');
  });

  it('handles nested directories', () => {
    mkdirSync(join(testDir, 'src', 'nested'));
    writeFileSync(join(testDir, 'src', 'nested', 'deep.ts'), '');
    const results = getFileCompletions('src/nested/', testDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe('deep.ts');
    expect(results[0]!.value).toBe('src/nested/deep.ts');
  });
});
