/**
 * Linux Landlock + seccomp sandbox (Module 4).
 *
 * Landlock is an unprivileged Linux kernel security module (Linux 5.13+)
 * that allows processes to self-impose filesystem access restrictions.
 * It's irreversible — once restrictions are applied, they cannot be
 * removed (even by the same process).
 *
 * Since Landlock is a Linux-only kernel feature accessed via syscalls,
 * this module provides:
 * 1. A TypeScript wrapper that shells out to `bubblewrap` (bwrap) as a
 *    fallback when native Landlock bindings aren't available
 * 2. Profile generation for bubblewrap that mirrors the Seatbelt modes
 *
 * For production use with native Landlock, Phase 5+ will add a Rust
 * native addon (via napi-rs) that calls the `landlock_create_ruleset`
 * and `landlock_restrict_self` syscalls directly. For Phase 5, bubblewrap
 * is the practical choice — it's available on most Linux distros and
 * provides equivalent isolation.
 *
 * @module sandbox/landlock
 */

import { createRequire } from 'node:module';
import type { NetworkAllowlist } from './seatbelt.js';
import type { SandboxMode } from './types.js';

/**
 * Generate a bubblewrap (bwrap) command for the given sandbox mode.
 *
 * @param mode - The sandbox mode.
 * @param workspaceRoot - The workspace root path.
 * @param command - The command to execute.
 * @param allowlist - Network allowlist (not directly enforced by bwrap;
 *                    enforced by the SOCKS5 proxy in Phase 5c).
 * @param _allowlist
 */
export function generateBubblewrapCommand(
  mode: SandboxMode,
  workspaceRoot: string,
  command: string,
  _allowlist?: NetworkAllowlist,
): string {
  switch (mode) {
    case 'read-only':
      return buildReadOnlyBwrap(workspaceRoot, command);
    case 'workspace-write':
      return buildWorkspaceWriteBwrap(workspaceRoot, command);
    case 'danger-full-access':
      // No sandbox — run directly
      return command;
    default:
      return buildReadOnlyBwrap(workspaceRoot, command);
  }
}

/**
 * Build a bubblewrap command for read-only mode.
 * @param workspaceRoot
 * @param command
 */
function buildReadOnlyBwrap(workspaceRoot: string, command: string): string {
  return [
    'bwrap',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--ro-bind', workspaceRoot, workspaceRoot,
    '--ro-bind', process.env['HOME'] ?? '/tmp', process.env['HOME'] ?? '/tmp',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--unshare-net',
    '--unshare-pid',
    '--die-with-parent',
    '--',
    command,
  ].join(' ');
}

/**
 * Build a bubblewrap command for workspace-write mode.
 * @param workspaceRoot
 * @param command
 */
function buildWorkspaceWriteBwrap(workspaceRoot: string, command: string): string {
  const tmpDir = process.env['TMPDIR'] ?? '/tmp';
  return [
    'bwrap',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--bind', workspaceRoot, workspaceRoot,
    '--ro-bind', process.env['HOME'] ?? '/tmp', process.env['HOME'] ?? '/tmp',
    '--bind', tmpDir, tmpDir,
    '--proc', '/proc',
    '--dev', '/dev',
    '--unshare-pid',
    '--die-with-parent',
    '--',
    command,
  ].join(' ');
}

/**
 * Check if bubblewrap is available on the system.
 */
export function isBubblewrapAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync probe at module-load
    const { execSync } = createRequire(import.meta.url)('node:child_process');
    execSync('which bwrap', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the kernel supports Landlock (Linux 5.13+).
 */
export function isLandlockSupported(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync probe at module-load
    const { readFileSync } = createRequire(import.meta.url)('node:fs');
    const version = readFileSync('/proc/version', 'utf-8');
    const match = version.match(/Linux version (\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1] ?? '0', 10);
    const minor = parseInt(match[2] ?? '0', 10);
    return major > 5 || (major === 5 && minor >= 13);
  } catch {
    return false;
  }
}
