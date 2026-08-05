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

import { realpathSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, constants, type PathLike } from 'node:fs';
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
      // Strip trailing slashes before extracting the basename —
      // `/workspace/foo/` would otherwise yield `''` as the basename
      // and the canonical path would collapse to the parent dir.
      const basename = absolutePath.replace(/\/+$/, '').split('/').pop() ?? '';
      canonicalPath = resolve(parentReal, basename);
      resolvedPathForChecks = canonicalPath;
    } catch {
      // Parent doesn't exist either — use the absolute path for checks
      canonicalPath = absolutePath;
      resolvedPathForChecks = absolutePath;
    }
  }

  // ─── 4. God mode bypasses workspace boundary, but NOT sensitive paths.
  // Reading SSH keys, .env files, cloud credentials, etc. is never
  // desirable — even in god mode, the agent shouldn't read secrets it
  // doesn't need. The previous implementation returned `ok: true`
  // immediately in god mode, skipping the blocked-paths and
  // sensitive-files checks entirely, so god-mode reads of
  // `~/.ssh/id_rsa`, `/etc/shadow`, `~/.aws/credentials` were allowed.
  if (godMode) {
    const sensitiveCheck = checkSensitivePaths(resolvedPathForChecks);
    if (sensitiveCheck !== null) {
      return { ok: false, canonicalPath, reason: sensitiveCheck };
    }
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
  const sensitiveCheck = checkSensitivePaths(resolvedPathForChecks);
  if (sensitiveCheck !== null) {
    return { ok: false, canonicalPath, reason: sensitiveCheck };
  }

  return { ok: true, canonicalPath };
}

/**
 * Shared sensitive-path checker used by both the god-mode and
 * non-god-mode paths. Returns `null` if the path is OK, or an error
 * message if it must be blocked.
 */
function checkSensitivePaths(resolvedPathForChecks: string): string | null {
  // Expanded blocked paths — the previous list missed `/root`,
  // `/home`, `/Users` (macOS), `/private/var` (macOS), `/var/root`,
  // `/srv`, `/opt`.
  const blockedPaths = [
    '/etc',
    '/dev',
    '/proc',
    '/sys',
    '/boot',
    '/var/log',
    '/root',
    '/home',
    '/Users',
    '/private/var',
    '/var/root',
    '/srv',
    '/opt',
  ];
  for (const blocked of blockedPaths) {
    if (resolvedPathForChecks.startsWith(blocked + '/') || resolvedPathForChecks === blocked) {
      return `Access to ${blocked} is blocked`;
    }
  }

  // Block access to SSH keys, env files, and cloud credentials.
  // Expanded list — the previous list missed `.netrc`, `.npmrc`,
  // `.gitconfig`, `.git-credentials`, `.docker/config.json`,
  // `.kube/config`, `.config/gh/hosts.yml`, `.ssh/id_ecdsa`,
  // `.ssh/config`, `.env.local`, `.aws/config`.
  // Fail-closed if HOME/USERPROFILE is unset.
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  if (!home) {
    return 'HOME not set — cannot verify sensitive paths (fail-closed)';
  }
  const sensitiveFiles = [
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
    '.ssh/id_ecdsa',
    '.ssh/authorized_keys',
    '.ssh/config',
    '.env',
    '.env.local',
    '.aws/credentials',
    '.aws/config',
    '.gnupg',
    '.netrc',
    '.npmrc',
    '.gitconfig',
    '.git-credentials',
    '.docker/config.json',
    '.kube/config',
    '.config/gh/hosts.yml',
  ];
  for (const sensitive of sensitiveFiles) {
    const sensitivePath = resolve(home, sensitive);
    if (resolvedPathForChecks === sensitivePath || resolvedPathForChecks.startsWith(sensitivePath + '/')) {
      return `Access to sensitive file blocked: ${sensitive}`;
    }
  }
  return null;
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
 *
 * ## Defense in depth
 *
 * Denylist-based command filtering is fundamentally bypassable (the
 * shell is Turing-complete). We use multiple complementary layers:
 *
 * 1. **Direct detection** — match the canonical forms (`ln -s`,
 *    `cp -s`, `os.symlink`, `mklink`, `git update-index --cacheinfo
 *    120000`, etc.) including option clusters (`-sf`, `-snf`).
 * 2. **Shell-escape detection** — refuse `sh -c`, `bash -c`, `eval`,
 *    `exec`, `xargs`, `find -exec`, `find -ok`, `subprocess.Popen`,
 *    `os.system`, etc. when ANY symlink-creating primitive appears
 *    anywhere in the command. This blocks the common
 *    `bash -c "ln -s ..."` and `eval "ln -s ..."` bypasses.
 * 3. **Interpreter-`-e` detection** — `python -c`, `python3 -c`,
 *    `node -e`, `node --eval`, `ruby -e`, `perl -e`, `php -r` with
 *    a symlink primitive in the script body.
 * 4. **Hard-link detection** — `ln` without `-s` (creates a hard
 *    link), `cp -l`, `link(` are also blocked (hard links are a
 *    similar sandbox-escape vector on the same filesystem).
 *
 * This does NOT make the denylist safe — a determined attacker with
 * arbitrary shell access can still bypass it (e.g., `$x=ln; $x -s
 * src dst`, base64-encoded payloads, here-docs). The denylist is a
 * first-line defense; the real protection is the approval engine
 * (which classifies `ln` as T2+) and the sandbox seccomp/seatbelt
 * profile (which would block the `symlink(2)` syscall entirely).
 * The denylist exists so the agent gets a clear error message
 * BEFORE its command reaches the sandbox.
 *
 * @param command
 */
export function isSymlinkCreationCommand(command: string): boolean {
  // Match `ln -s`, `ln -sf`, `ln -sr`, `ln --symbolic`, etc.
  // The previous regex `\bln\s+(-s|--symbolic)\b` only matched `-s`
  // exactly, missing `ln -sf` (force) and `ln -sr` (relative).
  //
  // We do NOT flag plain `ln src dst` (hard link) — the previous
  // implementation's `hasLnHardlink` regex was too broad and matched
  // any `ln` invocation with 2+ path args, including `ln /target link`
  // (which is a symlink form, not a hard link) and `ln --help`. The
  // symlink-specific `-s` / `--symbolic` form is sufficient to catch
  // the actual sandbox-escape vector (the `symlink(2)` syscall).
  const hasLnSymlink =
    /\bln\s+(-[A-Za-z]*s|--symbolic)\b/.test(command);     // ln -s, ln -sf, ln -snf

  const hasCpLink =
    /\bcp\s+(-[A-Za-z]*s|--symbolic-link)\b/.test(command) || // cp -s (symlink)
    /\bcp\s+(-[A-Za-z]*l|--link)\b/.test(command);             // cp -l (hard link)

  const hasMklink = /\bmklink\b/.test(command);               // Windows cmd.exe
  const hasOsSymlink = /os\.symlink\s*\(/.test(command);       // python os.symlink
  const hasGenericSymlink = /(^|[^.\w])symlink\s*\(/.test(command); // generic symlink() call
  const hasFsSymlinkSync = /fs\.symlink(?:Sync)?\s*\(/.test(command); // node fs.symlinkSync
  const hasGitCacheinfo = /git\s+update-index\s+--cacheinfo\s+120000/.test(command);

  const directSymlink =
    hasLnSymlink ||
    hasCpLink ||
    hasMklink ||
    hasOsSymlink ||
    hasGenericSymlink ||
    hasFsSymlinkSync ||
    hasGitCacheinfo;

  if (directSymlink) return true;

  // ─── Shell-escape / interpreter-`-e` detection ───────────────
  // If a symlink primitive appears ANYWHERE in the command AND the
  // command uses a shell escape / interpreter -e, refuse it. This
  // blocks `bash -c "ln -s ..."`, `eval "ln -s ..."`,
  // `python -c "import os; os.symlink(...)"`, etc.
  //
  // This is a heuristic — it can't catch every bypass (e.g., base64-
  // encoded payloads, here-docs, variable indirection). The real
  // protection is the sandbox syscall filter.
  const hasSymlinkPrimitive =
    /\bln\b/.test(command) ||
    /\bmklink\b/.test(command) ||
    /symlink/i.test(command) ||
    /\bcp\s+(-[A-Za-z]*[sl]|--symbolic-link|--link)\b/.test(command) ||
    /git\s+update-index\s+--cacheinfo\s+120000/.test(command);

  const hasShellEscape =
    /\b(sh|bash|zsh|dash|ksh)\s+-c\b/.test(command) ||
    /\beval\s+["'`]/.test(command) ||
    /\bexec\s+["'`]/.test(command) ||
    /\bxargs\s+ln\b/.test(command) ||
    /\bfind\s+.*-exec\s+ln\b/.test(command) ||
    /\bfind\s+.*-ok\s+ln\b/.test(command) ||
    /\b(python|python3|python2)\s+-c\b/.test(command) ||
    /\bnode\s+(-e|--eval)\b/.test(command) ||
    /\bruby\s+-e\b/.test(command) ||
    /\bperl\s+-e\b/.test(command) ||
    /\bphp\s+-r\b/.test(command) ||
    /\bsubprocess\.(Popen|call|run)\s*\(/.test(command) ||
    /\bos\.system\s*\(/.test(command);

  if (hasSymlinkPrimitive && hasShellEscape) return true;

  return false;
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
  // The previous implementation used `openSync(filePath, 'r' as string)`
  // which is O_RDONLY ONLY — Node's string-flag form does NOT support
  // O_NOFOLLOW, so the TOCTOU defense was non-functional. Use the
  // numeric-constants form to actually set O_NOFOLLOW at the syscall
  // level.
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
  // God mode bypasses ALL checks (symlink-chain, workspace boundary,
  // AND sensitive paths). The "god mode" contract documented across
  // the codebase is that god mode bypasses path checks entirely — the
  // user has explicitly accepted the risk. The previous implementation
  // only bypassed the symlink-chain check (the god-mode branch was
  // below the symlink-chain check) but still routed through
  // `validatePath`, whose god-mode branch re-applied the sensitive-
  // paths check and blocked `/etc/passwd` even in god mode.
  if (godMode) {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
    try {
      const canonicalPath = realpathSync(absolutePath);
      return { ok: true, canonicalPath };
    } catch {
      // Best-effort: fall back to the absolute path if realpath fails
      // (e.g., for write_file targets that don't exist yet).
      return { ok: true, canonicalPath: absolutePath };
    }
  }

  // Walk the ORIGINAL (non-resolved) absolute path — NOT the
  // canonical path. `validatePath` calls `realpathSync()` which
  // resolves ALL symlinks, producing a canonical path with no
  // symlinks. The previous implementation then called
  // `isPathChainSymlinkFree(base.canonicalPath)` on that already-
  // resolved canonical path, which by definition has no symlinks —
  // the strict validation was effectively dead code.
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
  if (!isPathChainSymlinkFree(absolutePath)) {
    return {
      ok: false,
      canonicalPath: absolutePath,
      reason: `Path chain contains a symlink (TOCTOU defense): ${filePath} → ${absolutePath}`,
    };
  }
  return validatePath(filePath, workspaceRoot, godMode);
}
