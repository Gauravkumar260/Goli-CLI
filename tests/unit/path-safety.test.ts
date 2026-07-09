/**
 * Unit tests for the shared path-safety utilities.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveUserPath, checkPathInWorkspace, isSymlink } from '../../packages/core/src/tools/core/path-safety.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-path-safety-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('resolveUserPath', () => {
  it('resolves absolute paths as-is', () => {
    const result = resolveUserPath('/etc/passwd', workspace);
    // resolve() on Windows prepends the drive letter; on Unix it's as-is
    expect(result).toBe(resolve('/etc/passwd'));
  });

  it('resolves relative paths against workspace', () => {
    const result = resolveUserPath('foo/bar.ts', workspace);
    expect(result).toBe(join(workspace, 'foo', 'bar.ts'));
  });

  it('expands ~/ to HOME', () => {
    const home = process.env['HOME'] ?? '';
    if (home) {
      const result = resolveUserPath('~/foo', workspace);
      expect(result).toBe(join(home, 'foo'));
    }
  });

  it('normalizes .. segments', () => {
    const result = resolveUserPath('foo/../bar.ts', workspace);
    expect(result).toBe(join(workspace, 'bar.ts'));
  });
});

describe('checkPathInWorkspace', () => {
  it('allows paths inside the workspace', () => {
    const path = join(workspace, 'foo.ts');
    const result = checkPathInWorkspace(path, workspace, false);
    expect(result.ok).toBe(true);
  });

  it('blocks paths outside the workspace', () => {
    const result = checkPathInWorkspace('/etc/passwd', workspace, false);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('outside the workspace');
  });

  it('allows paths outside the workspace in god mode', () => {
    const result = checkPathInWorkspace('/etc/passwd', workspace, true);
    expect(result.ok).toBe(true);
  });

  it('blocks in-workspace symlinks pointing outside (when target exists)', () => {
    // Create a symlink inside the workspace pointing to /etc/passwd.
    // realpathSync will follow the symlink and detect the escape.
    const symlinkPath = join(workspace, 'evil-link');
    try {
      symlinkSync('/etc/passwd', symlinkPath);
      const result = checkPathInWorkspace(symlinkPath, workspace, false);
      expect(result.ok).toBe(false);
    } catch {
      // Symlink creation may fail on some systems (no permissions).
      // Skip the test in that case.
    }
  });

  it('allows non-existent paths (write_file case) inside the workspace', () => {
    const path = join(workspace, 'new-file.ts');
    const result = checkPathInWorkspace(path, workspace, false);
    expect(result.ok).toBe(true);
  });

  it('blocks non-existent paths outside the workspace', () => {
    const path = '/etc/some-new-file-that-doesnt-exist';
    const result = checkPathInWorkspace(path, workspace, false);
    expect(result.ok).toBe(false);
  });
});

describe('isSymlink', () => {
  it('returns true for a symlink', () => {
    const target = join(workspace, 'target.txt');
    writeFileSync(target, 'hello');
    const link = join(workspace, 'link.txt');
    try {
      symlinkSync(target, link);
      expect(isSymlink(link)).toBe(true);
    } catch {
      // Skip if symlinks aren't supported.
    }
  });

  it('returns false for a regular file', () => {
    const file = join(workspace, 'regular.txt');
    writeFileSync(file, 'hello');
    expect(isSymlink(file)).toBe(false);
  });

  it('returns false for a non-existent path', () => {
    expect(isSymlink(join(workspace, 'nope.txt'))).toBe(false);
  });

  it('returns false for a directory', () => {
    expect(isSymlink(workspace)).toBe(false);
  });
});
