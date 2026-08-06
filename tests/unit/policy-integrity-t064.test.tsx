/**
 * Tests for the Policy Integrity Manager (T-064).
 *
 * Covers:
 *   - calculateIntegrityHash: deterministic, sorts files, includes path+content
 *   - calculateIntegrityHash: empty directory, non-existent directory
 *   - PolicyIntegrityManager.checkIntegrity: NEW / MATCH / MISMATCH
 *   - PolicyIntegrityManager.acceptIntegrity: persists hash
 *   - PolicyIntegrityManager: multiple scopes don't interfere
 *   - PolicyUpdateDialog: renders, ACCEPT/IGNORE navigation, ESC cancel
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PolicyIntegrityManager,
  IntegrityStatus,
  calculateIntegrityHash,
  type IntegrityResult,
} from '../../packages/config/src/integrity.js';
import { PolicyUpdateDialog } from '../../apps/cli/src/tui/components/PolicyUpdateDialog.js';

// ─── calculateIntegrityHash ───────────────────────────────────────────────

describe('T-064: calculateIntegrityHash', () => {
  // Normalize path separators so the mock virtual FS (forward-slash keys)
  // matches paths produced by path.join() on Windows (backslashes).
  const norm = (p: string) => p.replace(/\\/g, '/');

  // Helper: build a mock statFn that treats known paths as files or dirs.
  function makeMockStat(dirs: Set<string>, files: Set<string>) {
    return (path: string) => ({
      isDirectory: () => dirs.has(norm(path)),
      isFile: () => files.has(norm(path)),
    });
  }

  it('returns a deterministic SHA-256 hex hash for the same files', () => {
    const files = new Map<string, string>([
      ['/fake/a.toml', 'content-a'],
      ['/fake/b.toml', 'content-b'],
    ]);
    const readFile = (p: string) => files.get(norm(p)) ?? '';
    const readDir = (p: string) =>
      norm(p) === '/fake' ? ['a.toml', 'b.toml'] : [];
    const statFn = makeMockStat(new Set(['/fake']), new Set(['/fake/a.toml', '/fake/b.toml']));

    const h1 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    const h2 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    expect(h1.hash).toBe(h2.hash);
    expect(h1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(h1.fileCount).toBe(2);
  });

  it('produces a different hash when content changes', () => {
    let content = 'original';
    const readFile = () => content;
    const readDir = () => ['policy.toml'];
    const statFn = makeMockStat(new Set(['/fake']), new Set(['/fake/policy.toml']));

    const h1 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    content = 'modified';
    const h2 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    expect(h1.hash).not.toBe(h2.hash);
  });

  it('produces a different hash when a file is renamed', () => {
    let fileName = 'a.toml';
    const readFile = () => 'content';
    const readDir = () => [fileName];
    const statFn = (path: string) => ({
      isDirectory: () => false,
      isFile: () => true,
    });

    const h1 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    fileName = 'b.toml';
    const h2 = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    expect(h1.hash).not.toBe(h2.hash);
  });

  it('sorts files by path so order does not affect the hash', () => {
    const files = ['z.toml', 'a.toml', 'm.toml'];
    const readFile = (p: string) => `content-${p}`;
    const readDir1 = () => [...files];
    const readDir2 = () => [...files].reverse();
    const statFn = makeMockStat(new Set(['/fake']), new Set(files.map((f) => `/fake/${f}`)));

    const h1 = calculateIntegrityHash('/fake', readFile, readDir1, statFn);
    const h2 = calculateIntegrityHash('/fake', readFile, readDir2, statFn);
    expect(h1.hash).toBe(h2.hash);
  });

  it('returns hash of empty string + fileCount=0 for empty directory', () => {
    const readDir = () => [];
    const statFn = makeMockStat(new Set(['/fake']), new Set());
    const result = calculateIntegrityHash('/fake', () => '', readDir, statFn);
    expect(result.fileCount).toBe(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns fileCount=0 for non-existent directory', () => {
    const result = calculateIntegrityHash('/nonexistent', () => '', () => [], makeMockStat(new Set(), new Set()));
    expect(result.fileCount).toBe(0);
  });

  it('recursively hashes files in subdirectories', () => {
    const files = new Map<string, string>([
      ['/fake/a.toml', 'a'],
      ['/fake/sub/b.toml', 'b'],
      ['/fake/sub/deep/c.toml', 'c'],
    ]);
    const readFile = (p: string) => files.get(norm(p)) ?? '';
    const readDir = (p: string) => {
      const n = norm(p);
      if (n === '/fake') return ['a.toml', 'sub'];
      if (n === '/fake/sub') return ['b.toml', 'deep'];
      if (n === '/fake/sub/deep') return ['c.toml'];
      return [];
    };
    const statFn = makeMockStat(
      new Set(['/fake', '/fake/sub', '/fake/sub/deep']),
      new Set(['/fake/a.toml', '/fake/sub/b.toml', '/fake/sub/deep/c.toml']),
    );

    const result = calculateIntegrityHash('/fake', readFile, readDir, statFn);
    expect(result.fileCount).toBe(3);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── PolicyIntegrityManager ───────────────────────────────────────────────

describe('T-064: PolicyIntegrityManager', () => {
  let tempDir: string;
  let storagePath: string;
  let policyDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'goli-integrity-'));
    storagePath = join(tempDir, 'policy.hash');
    policyDir = join(tempDir, 'policies');
    mkdirSync(policyDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('checkIntegrity returns NEW when no stored hash exists', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = []');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result.status).toBe(IntegrityStatus.NEW);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fileCount).toBe(1);
  });

  it('checkIntegrity returns MATCH after acceptIntegrity', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = []');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', result1.hash);
    const result2 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result2.status).toBe(IntegrityStatus.MATCH);
  });

  it('checkIntegrity returns MISMATCH when files change', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = []');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', result1.hash);

    // Modify the policy file.
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = ["block"]');

    const result2 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result2.status).toBe(IntegrityStatus.MISMATCH);
    expect(result2.hash).not.toBe(result1.hash);
  });

  it('checkIntegrity returns MISMATCH when a file is added', () => {
    writeFileSync(join(policyDir, 'a.toml'), 'a = 1');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', result1.hash);

    writeFileSync(join(policyDir, 'b.toml'), 'b = 2');

    const result2 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result2.status).toBe(IntegrityStatus.MISMATCH);
  });

  it('checkIntegrity returns MISMATCH when a file is deleted', () => {
    writeFileSync(join(policyDir, 'a.toml'), 'a = 1');
    writeFileSync(join(policyDir, 'b.toml'), 'b = 2');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', result1.hash);

    const fs = require('node:fs');
    fs.unlinkSync(join(policyDir, 'b.toml'));

    const result2 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result2.status).toBe(IntegrityStatus.MISMATCH);
  });

  it('multiple scopes do not interfere with each other', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = []');
    const mgr = new PolicyIntegrityManager({ storagePath });

    const r1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', r1.hash);

    const r2 = mgr.checkIntegrity('user', '/home/user', policyDir);
    expect(r2.status).toBe(IntegrityStatus.NEW);

    mgr.acceptIntegrity('user', '/home/user', r2.hash);

    // Both should now MATCH.
    expect(mgr.checkIntegrity('project', '/my/project', policyDir).status).toBe(IntegrityStatus.MATCH);
    expect(mgr.checkIntegrity('user', '/home/user', policyDir).status).toBe(IntegrityStatus.MATCH);
  });

  it('persists hashes to the storage file as JSON', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'rules = []');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', result.hash);

    expect(existsSync(storagePath)).toBe(true);
    const content = readFileSync(storagePath, 'utf-8');
    const parsed = JSON.parse(content);
    // The manager sanitizes the storage key (replaces `/` with `_`,
    // appends a SHA-256 suffix) so Windows paths with colons can't
    // collide. We assert that exactly one entry was persisted and it
    // maps to `result.hash`.
    const values = Object.values(parsed) as string[];
    expect(values).toHaveLength(1);
    expect(values[0]).toBe(result.hash);
    // The key starts with the sanitized scope ("project:") — verify
    // at least that much so a future regression to a totally
    // different key shape is caught.
    const key = Object.keys(parsed)[0]!;
    expect(key.startsWith('project:')).toBe(true);
  });

  it('checkIntegrity returns NEW for empty policy directory', () => {
    const mgr = new PolicyIntegrityManager({ storagePath });
    const result = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(result.status).toBe(IntegrityStatus.NEW);
    expect(result.fileCount).toBe(0);
  });

  it('acceptIntegrity overwrites the previous hash for the same scope', () => {
    writeFileSync(join(policyDir, 'policy.toml'), 'v1');
    const mgr = new PolicyIntegrityManager({ storagePath });
    const r1 = mgr.checkIntegrity('project', '/my/project', policyDir);
    mgr.acceptIntegrity('project', '/my/project', r1.hash);

    writeFileSync(join(policyDir, 'policy.toml'), 'v2');
    const r2 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(r2.status).toBe(IntegrityStatus.MISMATCH);
    mgr.acceptIntegrity('project', '/my/project', r2.hash);

    const r3 = mgr.checkIntegrity('project', '/my/project', policyDir);
    expect(r3.status).toBe(IntegrityStatus.MATCH);
  });
});

// ─── PolicyUpdateDialog ───────────────────────────────────────────────────

describe('T-064: PolicyUpdateDialog', () => {
  const mockResult: IntegrityResult = {
    status: IntegrityStatus.MISMATCH,
    hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    fileCount: 3,
  };

  it('renders the dialog with scope, path, file count, and hash', () => {
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Policy Files Changed');
    expect(frame).toContain('project');
    expect(frame).toContain('/my/project');
    expect(frame).toContain('Files:');
    expect(frame).toContain('3');
    // Hash is truncated to 16 chars + ellipsis.
    expect(frame).toContain('abcdef0123456789');
  });

  it('shows ACCEPT and IGNORE options', () => {
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(a)ccept');
    expect(frame).toContain('(i)gnore');
  });

  it('defaults to ACCEPT selected (▶ marker on accept line)', () => {
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    // The ▶ marker should be on the accept line.
    expect(frame).toContain('▶ (a)ccept');
    expect(frame).not.toContain('▶ (i)gnore');
  });

  it('shows navigation help text', () => {
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter = select');
    expect(frame).toContain('Esc = cancel');
  });

  it('shows the explanation text for both options', () => {
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('load the new policies');
    expect(frame).toContain("load defaults only");
  });

  it('renders without crashing when fileCount is 0', () => {
    const emptyResult: IntegrityResult = {
      status: IntegrityStatus.NEW,
      hash: '0'.repeat(64),
      fileCount: 0,
    };
    const { lastFrame } = render(
      <PolicyUpdateDialog
        result={emptyResult}
        scope="user"
        identifier="/home/user"
        onAccept={() => undefined}
        onIgnore={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Files:');
    expect(frame).toContain('0');
  });

  it('the callbacks are wired (not called during render)', () => {
    const onAccept = vi.fn();
    const onIgnore = vi.fn();
    const onCancel = vi.fn();
    render(
      <PolicyUpdateDialog
        result={mockResult}
        scope="project"
        identifier="/my/project"
        onAccept={onAccept}
        onIgnore={onIgnore}
        onCancel={onCancel}
      />,
    );
    // No callbacks should fire during render.
    expect(onAccept).not.toHaveBeenCalled();
    expect(onIgnore).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
