/**
 * lib/pathUtils.ts — Path formatting utilities for the TUI.
 *
 * T-039 (loop run 4): closes a UI gap vs gemini-cli, which has a 543-line
 * Footer.tsx with `tildeifyPath`, `shortenPath`, and `getDisplayString`
 * utilities for rendering the current working directory in a compact form.
 *
 * This module provides:
 *   - `tildeify(path)`     — replace $HOME with ~
 *   - `shortenPath(path)`  — abbreviate intermediate dirs (~/v/l/path)
 *   - `displayPath(path)`  — tildeify + shorten, ready for display
 */

import { homedir } from 'node:os';

/**
 * Normalize path separators to forward slashes. `path.join()` produces
 * backslashes on Windows; the TUI renders paths with `/` regardless, so
 * utilities operate on a normalized form.
 */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Replace the home directory prefix with `~`.
 *
 *   /home/alice/project  →  ~/project
 *   /Users/bob/code      →  ~/code
 *   /tmp/other           →  /tmp/other  (no change — not under home)
 *   ~                    →  ~  (already tildeified)
 */
export function tildeify(inputPath: string): string {
  if (!inputPath || inputPath.length === 0) return inputPath;
  if (inputPath === '~') return '~';
  // Honor $HOME first (tests and many shells set it); os.homedir() does NOT
  // read $HOME on Windows — it uses the profile dir instead. When $HOME is
  // set, it is the authoritative home for tildeification.
  const home = normalizeSeparators(process.env.HOME || homedir());
  if (!home || home.length === 0) return inputPath;
  const p = normalizeSeparators(inputPath);
  // Match home prefix exactly (path-separator boundary).
  if (p === home) return '~';
  if (p.startsWith(home + '/')) {
    return '~' + p.slice(home.length);
  }
  // Not under home — return the original input unchanged.
  return inputPath;
}

/**
 * Shorten a path by abbreviating intermediate directory names to their
 * first character. The final component (basename) is preserved in full.
 *
 *   ~/very/long/path/name  →  ~/v/l/path/name
 *   /home/alice/projects/goli-cli  →  /h/a/projects/goli-cli  (if not tildeified)
 *   ~/p  →  ~/p  (no intermediate dirs to shorten)
 *   ~  →  ~  (nothing to shorten)
 *
 * The leading ~ or / is preserved. Single-component paths are returned
 * unchanged.
 */
export function shortenPath(inputPath: string): string {
  if (!inputPath || inputPath.length === 0) return inputPath;
  // Don't shorten very short paths — the abbreviation wouldn't save space.
  if (inputPath.length <= 20) return inputPath;

  // Split on /. The first element is usually '' for absolute paths,
  // or '~' for tildeified paths.
  const parts = inputPath.split('/');
  if (parts.length <= 2) return inputPath;

  // Preserve the first 1-2 parts (root or ~ + first dir) and the last 2 parts
  // (parent dir + basename). Abbreviate the middle parts to first char.
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    // First 1 parts (root marker '' or '~') and last 2 parts preserved.
    if (i === 0 || i >= parts.length - 2) {
      result.push(part);
    } else if (part.length <= 1) {
      // Already short — keep as-is.
      result.push(part);
    } else {
      // Abbreviate to first char + optional ellipsis if very long.
      result.push(part[0]!);
    }
  }
  return result.join('/');
}

/**
 * Tildeify + shorten a path for display in the TUI.
 *
 * This is the main entry point for StatusBar and other components that
 * show the current working directory.
 *
 *   /home/alice/very/long/project/path  →  ~/v/l/project/path
 *   /tmp/short  →  /tmp/short  (no change — already short)
 */
export function displayPath(inputPath: string): string {
  return shortenPath(tildeify(inputPath));
}

/**
 * Truncate a path to a maximum length, preserving the basename.
 *
 * Used when the terminal is too narrow even for the shortened path.
 *   ~/very/long/path/that/does/not/fit  →  ~/…/fit  (if maxLen=10)
 *
 * If the path fits, return it unchanged.
 */
export function truncatePath(inputPath: string, maxLen: number): string {
  if (inputPath.length <= maxLen) return inputPath;
  if (maxLen <= 3) return inputPath.slice(0, maxLen);

  // Find the basename (last path component).
  const lastSlash = inputPath.lastIndexOf('/');
  const basename = lastSlash >= 0 ? inputPath.slice(lastSlash + 1) : inputPath;

  // If even the basename + ~/… prefix doesn't fit, truncate the basename.
  const prefix = '~/…/';
  if (prefix.length + basename.length > maxLen) {
    return prefix + basename.slice(0, maxLen - prefix.length);
  }

  return prefix + basename;
}
