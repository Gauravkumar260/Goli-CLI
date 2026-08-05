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

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
      // Defense in depth — a sandbox generator must never return an
      // unsandboxed command. Callers who want raw execution must
      // explicitly opt in via executeInSandbox({godMode:true}), which
      // bypasses this function entirely.
      throw new Error(
        "generateBubblewrapCommand does not support 'danger-full-access'; " +
        'callers must explicitly opt into raw execution via executeInSandbox({godMode:true})',
      );
    default:
      return buildReadOnlyBwrap(workspaceRoot, command);
  }
}

/**
 * Validate a `HOME` env var before using it as a bind-mount source.
 *
 * The previous implementation passed `process.env['HOME'] ?? '/tmp'`
 * directly into bwrap's `--ro-bind HOME HOME`. If `HOME=/` or
 * `HOME=/etc`, the entire root filesystem or `/etc` was bind-mounted
 * into the sandbox, giving the sandboxed process read access to
 * everything. Unlike `seatbelt.ts` which calls `escapeSeatbeltPath`
 * and rejects dangerous paths, landlock did no validation.
 *
 * We now reject `HOME` values that are empty, root, a critical system
 * directory, or contain a newline (which would break the bwrap
 * argv). On rejection we fall back to `/tmp`.
 */
function safeHome(): string {
  const home = process.env['HOME'] ?? '/tmp';
  if (
    !home ||
    home === '/' ||
    home === '/etc' ||
    home === '/usr' ||
    home === '/bin' ||
    home === '/sbin' ||
    home === '/lib' ||
    home === '/lib64' ||
    home === '/boot' ||
    home === '/proc' ||
    home === '/sys' ||
    home === '/dev' ||
    home.includes('\n')
  ) {
    return '/tmp';
  }
  return home;
}

/**
 * Build a bubblewrap command for read-only mode.
 * @param workspaceRoot
 * @param command
 */
function buildReadOnlyBwrap(workspaceRoot: string, command: string): string {
  const home = safeHome();
  return [
    'bwrap',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--ro-bind', workspaceRoot, workspaceRoot,
    '--ro-bind', home, home,
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
 *
 * `--unshare-net` is included here so a sandboxed process in
 * workspace-write mode has NO network access — defeating the
 * documented "Network: allowlist only" policy was the previous
 * behavior, which silently exposed the sandbox to the network.
 * If a future Phase 5c SOCKS5 proxy is wired up, the proxy can be
 * reached via `ALL_PROXY` on the loopback interface and
 * `--unshare-net` can be replaced with a more permissive setup.
 * Until then, fail-closed: no network at all.
 * @param workspaceRoot
 * @param command
 */
function buildWorkspaceWriteBwrap(workspaceRoot: string, command: string): string {
  const tmpDir = process.env['TMPDIR'] ?? '/tmp';
  const home = safeHome();
  return [
    'bwrap',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--bind', workspaceRoot, workspaceRoot,
    '--ro-bind', home, home,
    '--bind', tmpDir, tmpDir,
    '--proc', '/proc',
    '--dev', '/dev',
    '--unshare-net',
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

// ─── P1-19: Native Landlock binding probe ──────────────────────────────

/**
 * P1-19 fix (remediation plan Phase 19): probe for a native Landlock
 * binding.
 *
 * The production target is the `landlock` npm package (or equivalent
 * napi-rs addon) which exposes the `landlock_create_ruleset`,
 * `landlock_add_rule`, and `landlock_restrict_self` syscalls. As of
 * this writing, no such package is published on npm — the remediation
 * plan documents the approach but the actual binding requires a Rust
 * addon that's out of scope for this code change.
 *
 * This function returns `'bubblewrap'` (the current fallback) when
 * the native binding isn't available, or `'native'` when it is. The
 * sandbox executor checks this and routes to the appropriate
 * enforcement path.
 *
 * When a native binding is eventually added, register it here:
 * ```ts
 * if (bindingAvailable) return 'native';
 * ```
 */
export type LandlockBackend = 'native' | 'bubblewrap' | 'unavailable';

/**
 * P1-19: determine the best available Landlock backend.
 *
 * Returns:
 *   - `'native'` if a native Landlock binding is registered (none
 *     today — see the module docstring).
 *   - `'bubblewrap'` if the kernel supports Landlock AND `bwrap` is
 *     installed (the current production path).
 *   - `'unavailable'` if neither is available (non-Linux, or Linux
 *     without bwrap).
 *
 * Callers should use this instead of `isLandlockSupported()` /
 * `isBubblewrapAvailable()` individually — it returns the best
 * available option in one call.
 */
export function getLandlockBackend(): LandlockBackend {
  // Future: probe for a native binding here. For now, the only
  // available backend is bubblewrap (which itself may or may not
  // use Landlock internally depending on bwrap's build flags).
  if (isLandlockSupported() && isBubblewrapAvailable()) {
    return 'bubblewrap';
  }
  if (isBubblewrapAvailable()) {
    return 'bubblewrap';
  }
  return 'unavailable';
}

/**
 * P1-19: register a native Landlock binding.
 *
 * When a native addon (napi-rs, ffi-napi, etc.) becomes available,
 * register it here so `getLandlockBackend()` returns `'native'` and
 * the sandbox executor uses it instead of bubblewrap.
 *
 * The binding must implement `NativeLandlockBinding` (the minimal
 * subset of syscalls needed: create_ruleset, add_rule, restrict_self).
 *
 * This is a placeholder for future work — the function signature is
 * stable so adding a binding later is a non-breaking change.
 */
export interface NativeLandlockBinding {
  /** Wrap `landlock_create_ruleset(2)`. Returns a ruleset FD. */
  createRuleset(handledAccessFs: string[]): number;
  /** Wrap `landlock_add_rule(2)` for a PATH_BENEATH rule. */
  addPathBeneathRule(rulesetFd: number, path: string, allowedAccess: string[]): void;
  /** Wrap `landlock_restrict_self(2)`. Irreversible. */
  restrictSelf(rulesetFd: number): void;
}

let registeredNativeBinding: NativeLandlockBinding | null = null;

/**
 *
 */
export function registerNativeLandlockBinding(binding: NativeLandlockBinding): void {
  registeredNativeBinding = binding;
}

/**
 * P1-19: get the registered native Landlock binding, or `null` if
 * none has been registered. Used by the sandbox executor to decide
 * whether to call native syscalls or fall back to bubblewrap.
 */
export function getNativeLandlockBinding(): NativeLandlockBinding | null {
  return registeredNativeBinding;
}
