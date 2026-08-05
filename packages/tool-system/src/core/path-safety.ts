/**
 * Shared path-safety utilities for the tools layer.
 *
 * The core tools (read_file, write_file, edit_file, grep, list_directory)
 * all need to:
 *   1. Resolve user-supplied paths (`~/foo`, `./bar`, `/abs/path`) to
 *      absolute paths.
 *   2. Verify the resolved path is inside the workspace.
 *   3. Detect symlinks that escape the workspace (a symlink inside the
 *      workspace pointing to `/etc/passwd` must be blocked).
 *
 * Previously each tool inlined this logic (with subtle differences and
 * bugs). This module is the single source of truth.
 *
 * @module tools/core/path-safety
 */

import { realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

/**
 * Resolve a user-supplied path to an absolute path.
 *
 * Handles:
 * - `~/foo` and `~user/foo` (home-dir expansion)
 * - `./foo` and `foo` (relative to `workspaceRoot`)
 * - `/abs/path` (returned as-is)
 *
 * @param rawPath - The user-supplied path.
 * @param workspaceRoot - The workspace root (for relative paths).
 * @returns The resolved absolute path (NOT yet symlink-resolved).
 */
export function resolveUserPath(rawPath: string, workspaceRoot: string): string {
  // Home-dir expansion. `~user/foo` is rare but valid.
  if (rawPath.startsWith('~/')) {
    const home = process.env['HOME'] ?? '';
    if (!home) {
      // No HOME — fall back to resolving relative to workspace.
      return resolve(workspaceRoot, rawPath);
    }
    return resolve(home, rawPath.slice(2));
  }
  if (rawPath === '~') {
    const home = process.env['HOME'] ?? '';
    return home || resolve(workspaceRoot, rawPath);
  }
  // Absolute path: return as-is.
  if (isAbsolute(rawPath)) {
    return resolve(rawPath);
  }
  // Relative path: resolve against workspace root.
  return resolve(workspaceRoot, rawPath);
}

/**
 * Check whether a path is inside a workspace directory.
 *
 * Uses `realpathSync` to resolve symlinks BEFORE checking the boundary,
 * so a symlink inside the workspace pointing to `/etc/passwd` is detected
 * and rejected. Falls back to a string-comparison check if the path
 * doesn't exist yet (write_file case) or if realpath fails.
 *
 * @param resolvedPath - The resolved absolute path (from `resolveUserPath`).
 * @param workspaceRoot - The workspace root.
 * @param godMode - If true, skip the boundary check (god mode bypasses safety).
 * @returns `'ok'` if the path is inside the workspace, or an error message.
 */
export function checkPathInWorkspace(
  resolvedPath: string,
  workspaceRoot: string,
  godMode: boolean,
): { ok: true; realPath?: string } | { ok: false; reason: string; realPath?: string } {
  if (godMode) return { ok: true, realPath: resolvedPath };

  // Try to resolve symlinks. If the file exists, realpathSync follows
  // the symlink chain to the final target — so an in-workspace symlink
  // pointing to /etc/passwd will be detected.
  let realPath: string;
  try {
    realPath = realpathSync(resolvedPath);
  } catch {
    // File doesn't exist yet (write_file case) or realpath failed.
    // Fall back to the resolved path (no symlink resolution).
    realPath = resolvedPath;
  }

  // Compute the relative path from workspace root. If it starts with
  // '..', the path is outside the workspace.
  const rel = relative(workspaceRoot, realPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      ok: false,
      realPath,
      reason: `Path "${resolvedPath}" resolves outside the workspace (to "${realPath}"). This is blocked for safety. Use --god mode to bypass.`,
    };
  }

  return { ok: true, realPath };
}

/**
 * Check whether a path is a symlink (without following it).
 *
 * Useful for tools that need to log/warn when the user operates on a
 * symlink (which may point outside the workspace).
 * @param path
 */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
