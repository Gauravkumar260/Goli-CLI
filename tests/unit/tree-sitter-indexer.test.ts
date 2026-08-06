/**
 * Unit tests for the tree-sitter indexer.
 */

import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TreeSitterIndexer } from '../../packages/context-engine/src/indexer/tree-sitter.js';

let workspace: string;
let indexer: TreeSitterIndexer;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-index-test-'));
  indexer = new TreeSitterIndexer();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('TreeSitterIndexer', () => {
  it('indexes a TypeScript file and extracts functions', () => {
    const filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, [
      'function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'function multiply(a: number, b: number): number {',
      '  return a * b;',
      '}',
    ].join('\n'));

    const chunks = indexer.indexFile(filePath);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('add');
    expect(names).toContain('multiply');
  });

  it('extracts classes and interfaces', () => {
    const filePath = join(workspace, 'types.ts');
    writeFileSync(filePath, [
      'interface User {',
      '  name: string;',
      '  age: number;',
      '}',
      '',
      'class UserService {',
      '  getUser(): User {',
      '    return { name: "x", age: 1 };',
      '  }',
      '}',
    ].join('\n'));

    const chunks = indexer.indexFile(filePath);
    const types = chunks.map((c) => c.symbolType);
    expect(types).toContain('interface');
    expect(types).toContain('class');
  });

  it('skips unchanged files on re-index (content-hash dedup)', () => {
    const filePath = join(workspace, 'dedup.ts');
    writeFileSync(filePath, 'function foo() { return 1; }\n');

    const chunks1 = indexer.indexFile(filePath);
    const chunks2 = indexer.indexFile(filePath);
    // Same reference (cached)
    expect(chunks1).toBe(chunks2);
  });

  it('re-indexes when file content changes', () => {
    const filePath = join(workspace, 'change.ts');
    writeFileSync(filePath, 'function foo() { return 1; }\n');
    const chunks1 = indexer.indexFile(filePath);

    writeFileSync(filePath, 'function bar() { return 2; }\n');
    const chunks2 = indexer.indexFile(filePath);

    expect(chunks1[0]!.symbolName).toBe('foo');
    expect(chunks2[0]!.symbolName).toBe('bar');
  });

  it('extracts Python functions and classes', () => {
    const filePath = join(workspace, 'test.py');
    writeFileSync(filePath, [
      'def greet(name):',
      '    return f"Hello, {name}"',
      '',
      'class Animal:',
      '    def speak(self):',
      '        pass',
    ].join('\n'));

    const chunks = indexer.indexFile(filePath);
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('greet');
    expect(names).toContain('Animal');
  });

  it('returns empty for unknown file types', () => {
    const filePath = join(workspace, 'readme.txt');
    writeFileSync(filePath, 'Some text content\n');
    const chunks = indexer.indexFile(filePath);
    expect(chunks).toEqual([]);
  });

  it('returns empty for non-existent files', () => {
    const chunks = indexer.indexFile(join(workspace, 'nope.ts'));
    expect(chunks).toEqual([]);
  });

  it('tracks indexed files', () => {
    const f1 = join(workspace, 'a.ts');
    const f2 = join(workspace, 'b.ts');
    writeFileSync(f1, 'function a() {}\n');
    writeFileSync(f2, 'function b() {}\n');

    indexer.indexFile(f1);
    indexer.indexFile(f2);

    expect(indexer.fileCount).toBe(2);
    expect(indexer.getIndexedFiles()).toContain(f1);
    expect(indexer.getIndexedFiles()).toContain(f2);
  });

  it('removeFile removes from index', () => {
    const filePath = join(workspace, 'remove.ts');
    writeFileSync(filePath, 'function foo() {}\n');
    indexer.indexFile(filePath);
    expect(indexer.fileCount).toBe(1);

    indexer.removeFile(filePath);
    expect(indexer.fileCount).toBe(0);
    expect(indexer.getChunksForFile(filePath)).toEqual([]);
  });

  it('getAllChunks returns all chunks across files', () => {
    const f1 = join(workspace, 'a.ts');
    const f2 = join(workspace, 'b.ts');
    writeFileSync(f1, 'function foo() {}\n');
    writeFileSync(f2, 'function bar() {}\n');

    indexer.indexFile(f1);
    indexer.indexFile(f2);

    const all = indexer.getAllChunks();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('detects language from extension', () => {
    expect(indexer.detectLanguage('test.ts')).toBe('typescript');
    expect(indexer.detectLanguage('test.tsx')).toBe('tsx');
    expect(indexer.detectLanguage('test.py')).toBe('python');
    expect(indexer.detectLanguage('test.rs')).toBe('rust');
    expect(indexer.detectLanguage('test.go')).toBe('go');
    expect(indexer.detectLanguage('test.txt')).toBeUndefined();
  });
});
