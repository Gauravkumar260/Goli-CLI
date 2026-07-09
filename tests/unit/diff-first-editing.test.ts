/**
 * Unit tests for H14: Diff-first editing.
 *
 * Verifies that:
 *   - `computeDiff` produces correct unified-diff output
 *   - `buildDiffEntry` constructs entries with pre-computed diff lines
 *   - `edit_file` calls the approval callback BEFORE writing
 *   - `edit_file` does NOT write when the user rejects
 *   - `edit_file` writes normally when no callback is set (backward compat)
 *   - `edit_file` writes normally when `diffReviewDisabled` is true
 *   - `write_file` calls the approval callback for overwrites
 *   - `write_file` skips the approval callback for identical content
 *   - `write_file` shows the diff in the result when no callback is set
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import {
  computeDiff,
  buildDiffEntry,
  formatDiffAsString,
} from '../../packages/core/src/tools/core/diff-utils.js';
import { EDIT_FILE_TOOL } from '../../packages/core/src/tools/core/edit-file.js';
import { WRITE_FILE_TOOL } from '../../packages/core/src/tools/core/write-file.js';

import type { ToolContext, DiffApprovalResult, DiffEntry } from '../../packages/core/src/tools/types.js';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: 'test-tc',
    workspaceRoot: '/tmp/test-workspace',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('returns empty array for identical content', () => {
    expect(computeDiff('hello\nworld\n', 'hello\nworld\n')).toEqual([]);
  });

  it('detects a single-line change', () => {
    const old = 'line1\nline2\nline3';
    const neu = 'line1\nCHANGED\nline3';
    const diff = computeDiff(old, neu);
    expect(diff.some((l) => l === '-line2')).toBe(true);
    expect(diff.some((l) => l === '+CHANGED')).toBe(true);
    expect(diff.some((l) => l === ' line1')).toBe(true);
    expect(diff.some((l) => l === ' line3')).toBe(true);
  });

  it('detects added lines', () => {
    const old = 'a\nb';
    const neu = 'a\nb\nc\nd';
    const diff = computeDiff(old, neu);
    expect(diff.some((l) => l === '+c')).toBe(true);
    expect(diff.some((l) => l === '+d')).toBe(true);
  });

  it('detects removed lines', () => {
    const old = 'a\nb\nc\nd';
    const neu = 'a\nb';
    const diff = computeDiff(old, neu);
    expect(diff.some((l) => l === '-c')).toBe(true);
    expect(diff.some((l) => l === '-d')).toBe(true);
  });

  it('handles empty old content (new file)', () => {
    const diff = computeDiff('', 'hello\nworld');
    expect(diff.some((l) => l === '+hello')).toBe(true);
    expect(diff.some((l) => l === '+world')).toBe(true);
    expect(diff.some((l) => l.startsWith('-'))).toBe(false);
  });

  it('limits context to 3 lines before and after', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const neu = old.replace('line10', 'CHANGED');
    const diff = computeDiff(old, neu);
    // Should have at most 3 context lines before + 1 removed + 1 added + 3 context after = 8 lines
    expect(diff.length).toBeLessThanOrEqual(8);
  });
});

describe('buildDiffEntry', () => {
  it('builds an entry with pre-computed diff lines', () => {
    const entry = buildDiffEntry('/foo.ts', 'edit_file', 'a\nb', 'a\nB');
    expect(entry.filePath).toBe('/foo.ts');
    expect(entry.tool).toBe('edit_file');
    expect(entry.oldContent).toBe('a\nb');
    expect(entry.newContent).toBe('a\nB');
    expect(entry.diffLines.length).toBeGreaterThan(0);
    expect(entry.diffLines.some((l) => l === '-b')).toBe(true);
    expect(entry.diffLines.some((l) => l === '+B')).toBe(true);
  });
});

describe('formatDiffAsString', () => {
  it('includes path header and diff body', () => {
    const entry = buildDiffEntry('/foo.ts', 'edit_file', 'a\nb', 'a\nB');
    const str = formatDiffAsString(entry);
    expect(str).toContain('--- /foo.ts');
    expect(str).toContain('+++ /foo.ts');
    expect(str).toContain('-b');
    expect(str).toContain('+B');
  });

  it('handles no-change case', () => {
    const entry = buildDiffEntry('/foo.ts', 'edit_file', 'same', 'same');
    expect(formatDiffAsString(entry)).toContain('no changes');
  });
});

describe('H14 edit_file diff-first', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h14-edit-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes directly when no approval callback is set (backward compat)', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'hello\nworld\n', 'utf-8');
    // Mark file as read so Read-before-Edit passes
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'hello', new_string: 'HELLO' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('HELLO\nworld\n');
    // Result should include the diff (since no callback was used)
    expect(result.content).toContain('-hello');
    expect(result.content).toContain('+HELLO');
  });

  it('calls the approval callback BEFORE writing', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'foo\nbar\n', 'utf-8');
    let callbackCalled = false;
    let capturedEntry: DiffEntry | undefined;
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      requestDiffApproval: async (entries) => {
        callbackCalled = true;
        capturedEntry = entries[0];
        return { accepted: [0], rejected: [] };
      },
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'foo', new_string: 'FOO' },
      ctx,
    );
    expect(callbackCalled).toBe(true);
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry!.filePath).toBe(filePath);
    expect(capturedEntry!.oldContent).toBe('foo\nbar\n');
    expect(capturedEntry!.newContent).toBe('FOO\nbar\n');
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('FOO\nbar\n');
    // When diff review was used, the result should NOT include the diff
    // (the user already saw it in the dialog).
    expect(result.content).not.toContain('-foo');
  });

  it('does NOT write when the user rejects the diff', async () => {
    const filePath = join(workspace, 'test.txt');
    const original = 'foo\nbar\n';
    writeFileSync(filePath, original, 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      requestDiffApproval: async () => ({ accepted: [], rejected: [0] }),
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'foo', new_string: 'FOO' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected');
    // File must be unchanged
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('handles rejectAll (user pressed R)', async () => {
    const filePath = join(workspace, 'test.txt');
    const original = 'foo\nbar\n';
    writeFileSync(filePath, original, 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      requestDiffApproval: async () => ({ accepted: [], rejected: [], rejectAll: true }),
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'foo', new_string: 'FOO' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected all diffs');
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('writes directly when diffReviewDisabled is true', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'foo\nbar\n', 'utf-8');
    let callbackCalled = false;
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      diffReviewDisabled: true,
      requestDiffApproval: async () => {
        callbackCalled = true;
        return { accepted: [0], rejected: [] };
      },
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'foo', new_string: 'FOO' },
      ctx,
    );
    expect(callbackCalled).toBe(false);
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('FOO\nbar\n');
  });

  it('respects acceptAll (user pressed A)', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'foo\nbar\n', 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      requestDiffApproval: async () => ({ accepted: [], rejected: [], acceptAll: true }),
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'foo', new_string: 'FOO' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('FOO\nbar\n');
  });
});

describe('H14 write_file diff-first', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h14-write-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes directly when no approval callback is set (backward compat)', async () => {
    const filePath = join(workspace, 'new.txt');
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'hello\nworld\n' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('hello\nworld\n');
    // Result should include the diff for new files
    expect(result.content).toContain('+hello');
    expect(result.content).toContain('+world');
  });

  it('calls the approval callback for overwrites', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'old content', 'utf-8');
    let callbackCalled = false;
    let capturedEntry: DiffEntry | undefined;
    const ctx = makeContext({
      workspaceRoot: workspace,
      requestDiffApproval: async (entries) => {
        callbackCalled = true;
        capturedEntry = entries[0];
        return { accepted: [0], rejected: [] };
      },
    });
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'new content' },
      ctx,
    );
    expect(callbackCalled).toBe(true);
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry!.oldContent).toBe('old content');
    expect(capturedEntry!.newContent).toBe('new content');
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('calls the approval callback for new files', async () => {
    const filePath = join(workspace, 'new.txt');
    let callbackCalled = false;
    let capturedEntry: DiffEntry | undefined;
    const ctx = makeContext({
      workspaceRoot: workspace,
      requestDiffApproval: async (entries) => {
        callbackCalled = true;
        capturedEntry = entries[0];
        return { accepted: [0], rejected: [] };
      },
    });
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'brand new' },
      ctx,
    );
    expect(callbackCalled).toBe(true);
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry!.oldContent).toBe('');
    expect(capturedEntry!.newContent).toBe('brand new');
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('brand new');
  });

  it('does NOT call the approval callback for identical content (no-op)', async () => {
    const filePath = join(workspace, 'same.txt');
    writeFileSync(filePath, 'same content', 'utf-8');
    let callbackCalled = false;
    const ctx = makeContext({
      workspaceRoot: workspace,
      requestDiffApproval: async () => {
        callbackCalled = true;
        return { accepted: [0], rejected: [] };
      },
    });
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'same content' },
      ctx,
    );
    // No diff → no callback
    expect(callbackCalled).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('does NOT write when the user rejects', async () => {
    const filePath = join(workspace, 'test.txt');
    const original = 'old content';
    writeFileSync(filePath, original, 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      requestDiffApproval: async () => ({ accepted: [], rejected: [0] }),
    });
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'new content' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected');
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });
});
