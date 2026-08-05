/**
 * Unit tests for path validation.
 */

import { mkdirSync, writeFileSync, rmSync, symlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { validatePath, isSymlink, isSymlinkCreationCommand } from '../../packages/core/src/sandbox/path-validation.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-path-test-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('validatePath', () => {
  it('allows paths within workspace', () => {
    const result = validatePath(join(workspace, 'file.ts'), workspace);
    expect(result.ok).toBe(true);
  });

  it('allows relative paths resolved within workspace', () => {
    // Use the workspace root itself (which exists) as a relative path test
    const result = validatePath('.', workspace);
    expect(result.ok).toBe(true);
  });

  it('blocks paths that escape workspace via ..', () => {
    const result = validatePath('../../../etc/passwd', workspace);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('escapes workspace');
  });

  it('blocks paths with null bytes (injection defense)', () => {
    const result = validatePath('file\0.ts', workspace);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('null bytes');
  });

  it('blocks access to /etc', () => {
    const result = validatePath('/etc/passwd', workspace);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('/etc');
  });

  it('blocks access to /dev', () => {
    const result = validatePath('/dev/sda', workspace);
    expect(result.ok).toBe(false);
  });

  it('blocks access to /proc', () => {
    const result = validatePath('/proc/self/environ', workspace);
    expect(result.ok).toBe(false);
  });

  it('blocks access to SSH keys (escapes workspace check)', () => {
    const home = process.env['HOME'] ?? '';
    const sshKey = join(home, '.ssh', 'id_rsa');
    const result = validatePath(sshKey, workspace);
    expect(result.ok).toBe(false);
    // The workspace-escape check fires first, but the result is still blocked
    expect(result.reason).toBeDefined();
  });

  it('blocks access to .env files', () => {
    const home = process.env['HOME'] ?? '';
    const envFile = join(home, '.env');
    const result = validatePath(envFile, workspace);
    expect(result.ok).toBe(false);
  });

  it('god mode allows paths outside workspace', () => {
    const result = validatePath('/tmp/some-file', workspace, true);
    // /tmp is not in the blocked list, so god mode should allow it
    expect(result.ok).toBe(true);
  });

  it('god mode still blocks /etc', () => {
    const result = validatePath('/etc/passwd', workspace, true);
    // Even in god mode, sensitive paths like /etc are blocked (defense
    // in depth — god mode bypasses the workspace boundary but NOT the
    // sensitive-paths check). The test name reflects the actual behavior.
    expect(result.ok).toBe(false);
  });

  it('canonicalizes paths via realpath', () => {
    // Create a symlink and verify it's resolved
    const realFile = join(workspace, 'real.ts');
    const linkFile = join(workspace, 'link.ts');
    writeFileSync(realFile, 'content');
    symlinkSync(realFile, linkFile);

    const result = validatePath(linkFile, workspace);
    expect(result.ok).toBe(true);
    expect(result.canonicalPath).toBe(realFile);
  });
});

describe('isSymlink', () => {
  it('detects symlinks', () => {
    const realFile = join(workspace, 'real.ts');
    const linkFile = join(workspace, 'link.ts');
    writeFileSync(realFile, 'content');
    symlinkSync(realFile, linkFile);

    expect(isSymlink(linkFile)).toBe(true);
    expect(isSymlink(realFile)).toBe(false);
  });

  it('returns false for non-existent paths', () => {
    expect(isSymlink(join(workspace, 'nonexistent'))).toBe(false);
  });
});

describe('isSymlinkCreationCommand', () => {
  it('detects ln -s', () => {
    expect(isSymlinkCreationCommand('ln -s /target link')).toBe(true);
    expect(isSymlinkCreationCommand('ln --symbolic /target link')).toBe(true);
  });

  it('does not flag ln without -s', () => {
    expect(isSymlinkCreationCommand('ln /target link')).toBe(false);
  });

  it('does not flag other commands', () => {
    expect(isSymlinkCreationCommand('echo hello')).toBe(false);
    expect(isSymlinkCreationCommand('ls -la')).toBe(false);
  });
});
