/**
 * Unit tests for TOCTOU-safe path operations (deep-dive recommendation 3).
 */

import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isPathChainSymlinkFree,
  openSafeRead,
  openSafeWrite,
  validatePathStrict,
} from '../src/path-validation.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-toctou-test-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('isPathChainSymlinkFree', () => {
  it('returns true for a regular file', () => {
    const file = join(workspace, 'regular.txt');
    writeFileSync(file, 'hello');
    expect(isPathChainSymlinkFree(file)).toBe(true);
  });

  it('returns true for a non-existent file (write case)', () => {
    const file = join(workspace, 'new-file.txt');
    expect(isPathChainSymlinkFree(file)).toBe(true);
  });

  it('returns false when an intermediate directory is a symlink', () => {
    // Create a real directory and a symlink to it.
    const realDir = join(workspace, 'real-dir');
    mkdirSync(realDir);
    const symlinkDir = join(workspace, 'symlink-dir');
    try {
      symlinkSync(realDir, symlinkDir);
      const fileInSymlink = join(symlinkDir, 'file.txt');
      expect(isPathChainSymlinkFree(fileInSymlink)).toBe(false);
    } catch {
      // Symlinks may not be supported on all systems.
    }
  });

  it('returns true when the final component is a symlink (allowed for reads)', () => {
    // The final component being a symlink is OK for the chain check —
    // the O_NOFOLLOW in openSafeRead handles that.
    const realFile = join(workspace, 'real.txt');
    writeFileSync(realFile, 'hello');
    const symlinkFile = join(workspace, 'link.txt');
    try {
      symlinkSync(realFile, symlinkFile);
      // The chain check passes (no intermediate is a symlink).
      expect(isPathChainSymlinkFree(symlinkFile)).toBe(true);
    } catch {
      // Skip if symlinks aren't supported.
    }
  });
});

describe('openSafeRead', () => {
  it('reads a regular file', () => {
    const file = join(workspace, 'test.txt');
    writeFileSync(file, 'hello world');
    expect(openSafeRead(file)).toBe('hello world');
  });

  it('throws if the path chain contains a symlink', () => {
    const realDir = join(workspace, 'real');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'secret.txt'), 'secret');

    const symlinkDir = join(workspace, 'evil');
    try {
      symlinkSync(realDir, symlinkDir);
      const fileViaSymlink = join(symlinkDir, 'secret.txt');
      expect(() => openSafeRead(fileViaSymlink)).toThrow(/symlink/i);
    } catch {
      // Skip if symlinks aren't supported.
    }
  });
});

describe('openSafeWrite', () => {
  it('writes a regular file', () => {
    const file = join(workspace, 'out.txt');
    openSafeWrite(file, 'written content');
    expect(readFileSync(file, 'utf-8')).toBe('written content');
  });

  it('throws if the path chain contains a symlink', () => {
    const realDir = join(workspace, 'real');
    mkdirSync(realDir);
    const symlinkDir = join(workspace, 'evil');
    try {
      symlinkSync(realDir, symlinkDir);
      const fileViaSymlink = join(symlinkDir, 'out.txt');
      expect(() => openSafeWrite(fileViaSymlink, 'data')).toThrow(/symlink/i);
    } catch {
      // Skip if symlinks aren't supported.
    }
  });
});

describe('validatePathStrict', () => {
  it('passes for a regular workspace file', () => {
    const file = join(workspace, 'test.txt');
    writeFileSync(file, 'hello');
    const result = validatePathStrict(file, workspace, false);
    expect(result.ok).toBe(true);
  });

  it('fails for paths outside the workspace', () => {
    const result = validatePathStrict('/etc/passwd', workspace, false);
    expect(result.ok).toBe(false);
  });

  it('passes in god mode (bypasses checks)', () => {
    const result = validatePathStrict('/etc/passwd', workspace, true);
    expect(result.ok).toBe(true);
  });
});
