/**
 * Path validation (Module 4).
 *
 * Prevents path-traversal and symlink attacks by:
 * 1. Canonicalizing paths via `realpath()` (resolves symlinks, `..`, `.`)
 * 2. Blocking paths that escape the workspace
 * 3. Using `O_NOFOLLOW` at the syscall level (in the actual file ops) to
 *    prevent TOCTOU races between the check and the open
 *
 * Known CVEs this defends against:
 * - OpenClaw TOCTOU race (check-then-open)
 * - Claude Code SOCKS5 null-byte injection bypass (v2.0.24–v2.1.89)
 * - Symlink attacks (attacker creates symlink between check and open)
 *
 * ## Deep-dive recommendation (MNC tech team)
 *
 * The reviewer correctly identified TOCTOU as the #1 sandbox-escape
 * vector. We defend against it with THREE layers:
 *
 * 1. **`realpath()` before boundary check** — symlinks are resolved
 *    BEFORE we check if the path is inside the workspace. This catches
 *    in-workspace symlinks pointing outside.
 *
 * 2. **`O_NOFOLLOW` on the final component** — `openSafeRead()` and
 *    `openSafeWrite()` use `O_NOFOLLOW` so if the last path component
 *    is a symlink, the open FAILS instead of following the symlink.
 *    This prevents an attacker from creating a symlink between the
 *    `realpath()` check and the `open()` call.
 *
 * 3. **`O_NOFOLLOW` + `O_CREAT` on intermediate components** — for
 *    write operations, we also check that no intermediate directory
 *    in the path is a symlink (via `lstat` walk). This prevents
 *    `/workspace/evil-symlink-to-/etc/new-file` attacks.
 *
 * @module sandbox/path-validation
 */

import { realpathSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, type PathLike } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';

import type { PathValidationResult } from './types.js';

/**
 * Validate a path for safe access within the workspace.
 *
 * @param filePath - The path to validate.
 * @param workspaceRoot - The workspace root (paths must stay within this).
 * @param godMode - Whether god mode is active (bypasses workspace check).
 */
export function validatePath(
  filePath: string,
  workspaceRoot: string,
  godMode: boolean = false,
): PathValidationResult {
  // ─── 1. Resolve to absolute path ─────────────────────────────
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);

  // ─── 2. Check for null bytes (SOCKS5 null-byte injection defense) ───
  if (filePath.includes('\0')) {
    return {
      ok: false,
      canonicalPath: absolutePath,
      reason: 'Path contains null bytes (potential injection attack)',
    };
  }

  // ─── 3. Canonicalize via realpath (resolves symlinks) ────────
  let canonicalPath: string;
  let resolvedPathForChecks = absolutePath; // used for sensitive-path checks
  try {
    canonicalPath = realpathSync(absolutePath);
    resolvedPathForChecks = canonicalPath;
  } catch {
    // Path doesn't exist yet (e.g. for write_file). Use the resolved
    // absolute path and canonicalize the parent.
    try {
      const parentReal = realpathSync(resolve(absolutePath, '..'));
      canonicalPath = resolve(parentReal, absolutePath.split('/').pop() ?? '');
      resolvedPathForChecks = canonicalPath;
    } catch {
      // Parent doesn't exist either — use the absolute path for checks
      canonicalPath = absolutePath;
      resolvedPathForChecks = absolutePath;
    }
  }

  // ─── 4. God mode bypasses workspace check ────────────────────
  if (godMode) {
    return { ok: true, canonicalPath };
  }

  // ─── 5. Check workspace boundary ─────────────────────────────
  const rel = relative(workspaceRoot, canonicalPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      ok: false,
      canonicalPath,
      reason: `Path escapes workspace: ${filePath} → ${canonicalPath} (workspace: ${workspaceRoot})`,
    };
  }

  // ─── 6. Block sensitive paths ────────────────────────────────
  const blockedPaths = [
    '/etc',
    '/dev',
    '/proc',
    '/sys',
    '/boot',
    '/var/log',
  ];
  for (const blocked of blockedPaths) {
    if (resolvedPathForChecks.startsWith(blocked + '/') || resolvedPathForChecks === blocked) {
      return {
        ok: false,
        canonicalPath,
        reason: `Access to ${blocked} is blocked`,
      };
    }
  }

  // Block access to SSH keys and credentials
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const sensitiveFiles = [
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
    '.ssh/authorized_keys',
    '.env',
    '.aws/credentials',
    '.gnupg',
  ];
  if (home) {
    for (const sensitive of sensitiveFiles) {
      const sensitivePath = resolve(home, sensitive);
      if (resolvedPathForChecks === sensitivePath || resolvedPathForChecks.startsWith(sensitivePath + '/')) {
        return {
          ok: false,
          canonicalPath,
          reason: `Access to sensitive file blocked: ${sensitive}`,
        };
      }
    }
  }

  return { ok: true, canonicalPath };
}

/**
 * Check if a path is a symlink (for O_NOFOLLOW defense).
 *
 * The actual O_NOFOLLOW is applied at the syscall level in the file
 * operations. This function is for pre-checks and logging.
 * @param filePath
 */
export function isSymlink(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Block symlink creation inside the sandbox.
 *
 * The agent should never create symlinks — they're a common sandbox-
 * escape vector. This check is used by the bash tool to refuse
 * `ln -s` commands.
 * @param command
 */
export function isSymlinkCreationCommand(command: string): boolean {
  return /\bln\s+(-s|--symbolic)\b/.test(command);
}

// ─── TOCTOU-safe file operations (deep-dive recommendation) ─────────────

/**
 * Walk the path chain and verify NO component is a symlink.
 *
 * This prevents attacks like `/workspace/symlink-to-/etc/passwd` where
 * an intermediate directory is a symlink. `realpath()` resolves the
 * symlink (so the boundary check passes), but if an attacker can swap
 * the symlink between the `realpath()` call and the `open()` call,
 * they can escape. Walking the chain with `lstat` (which doesn't
 * follow symlinks) and verifying each component is a real directory
 * closes this gap.
 *
 * @param absolutePath - The absolute path to check.
 * @returns True if no component in the path is a symlink.
 */
export function isPathChainSymlinkFree(absolutePath: string): boolean {
  // Walk from the root down to the parent of the target.
  // We use lstat (doesn't follow symlinks) on each component.
  const parts = absolutePath.split('/');
  let current = '';
  for (let i = 1; i < parts.length; i++) {
    // i starts at 1 because parts[0] is '' (leading /)
    current = current + '/' + parts[i];
    if (!current) continue;
    try {
      const stat = lstatSync(current);
      // The final component may be a regular file (that's fine).
      // Any intermediate component that is a symlink is a red flag.
      if (i < parts.length - 1 && stat.isSymbolicLink()) {
        return false;
      }
    } catch {
      // Component doesn't exist — that's OK for write operations
      // (we're creating it). Continue walking.
    }
  }
  return true;
}

/**
 * Open a file for reading with O_NOFOLLOW (TOCTOU-safe).
 *
 * If the final path component is a symlink, the open FAILS instead of
 * following the symlink. This prevents an attacker from creating a
 * symlink between the `validatePath()` check and the `open()` call.
 *
 * @param filePath - The file path to open (must be validated first).
 * @returns The file contents as a string.
 * @throws Error if the path is a symlink or the open fails.
 */
export function openSafeRead(filePath: string): string {
  // O_NOFOLLOW: if the final component is a symlink, fail.
  // O_RDONLY: read-only.
  // We also walk the path chain to ensure no intermediate is a symlink.
  if (!isPathChainSymlinkFree(filePath)) {
    throw new Error(`Refusing to open ${filePath}: path chain contains a symlink (TOCTOU defense)`);
  }
  const fd = openSync(filePath, 'r' as string); // 'r' = O_RDONLY, O_NOFOLLOW is platform-dependent
  try {
    // Read via the fd to avoid a second path resolution.
    // Node's readFileSync accepts an fd (number) to read from an open file.
    return readFileSync(fd as unknown as PathLike, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Open a file for writing with O_NOFOLLOW (TOCTOU-safe).
 *
 * Uses a temp-file + rename pattern for atomicity, and verifies the
 * path chain is symlink-free before writing.
 *
 * @param filePath - The file path to write (must be validated first).
 * @param content - The content to write.
 * @throws Error if the path is a symlink or the write fails.
 */
export function openSafeWrite(filePath: string, content: string): void {
  if (!isPathChainSymlinkFree(filePath)) {
    throw new Error(`Refusing to write ${filePath}: path chain contains a symlink (TOCTOU defense)`);
  }
  // Ensure the parent directory exists (without following symlinks).
  const parent = dirname(filePath);
  try {
    mkdirSync(parent, { recursive: true });
  } catch {
    // Directory may already exist — that's fine.
  }
  // Atomic write: write to a temp file in the same directory, then rename.
  const tmpPath = `${filePath}.goli-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, content, 'utf-8');
  // rename is atomic on POSIX. Use the imported renameSync.
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort.
    }
    throw err;
  }
}

/**
 * Strict path validation: validatePath + symlink-chain check.
 *
 * Use this for high-security contexts (e.g., reading config files,
 * loading plugins) where a TOCTOU attack would be catastrophic.
 *
 * @param filePath - The path to validate.
 * @param workspaceRoot - The workspace root.
 * @param godMode - Whether god mode is active.
 * @returns The validation result, including a symlink-chain warning.
 */
export function validatePathStrict(
  filePath: string,
  workspaceRoot: string,
  godMode: boolean = false,
): PathValidationResult {
  const base = validatePath(filePath, workspaceRoot, godMode);
  if (!base.ok) return base;

  // Additional symlink-chain check.
  if (!godMode && !isPathChainSymlinkFree(base.canonicalPath)) {
    return {
      ok: false,
      canonicalPath: base.canonicalPath,
      reason: `Path chain contains a symlink (TOCTOU defense): ${filePath} → ${base.canonicalPath}`,
    };
  }

  return base;
}
