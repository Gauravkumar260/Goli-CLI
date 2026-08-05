/**
 * lib/fileCompletion.ts — File-path Tab completion for @ prefix (T-082).
 *
 * Reference: gemini-cli's `useAtCompletion.ts` provides `@path/to/file`
 * completion. When the user types `@src/` and presses Tab, it lists
 * files/dirs under `src/` for selection.
 *
 * This module provides the path-scanning logic. The PromptInput component
 * wires it into the Tab key handler when the input starts with `@`.
 *
 * @module lib/fileCompletion
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** Maximum number of completions to return (to avoid flooding the TUI). */
export const MAX_FILE_COMPLETIONS = 20;

/**
 * A file-path completion candidate.
 */
export interface FileCompletion {
  /** The completion value to insert (relative path, without leading @). */
  value: string;
  /** Whether this entry is a directory (for trailing-slash behavior). */
  isDirectory: boolean;
  /** The display label (just the basename). */
  label: string;
}

/**
 * Get file-path completions for a partial path typed after `@`.
 *
 * @param partial The path typed so far (without the leading `@`).
 *                e.g. "src/", "src/ind", "package.json".
 * @param cwd The current working directory to resolve relative paths against.
 * @returns Array of completion candidates (max MAX_FILE_COMPLETIONS).
 */
export function getFileCompletions(partial: string, cwd: string = process.cwd()): FileCompletion[] {
  if (partial.length === 0) {
    // List top-level entries in cwd.
    return listDir(cwd, '');
  }

  // If the partial ends with a separator, list the directory contents.
  if (partial.endsWith('/') || partial.endsWith('\\')) {
    const dir = join(cwd, partial);
    return listDir(dir, partial);
  }

  // Otherwise, the partial is a prefix — list entries in the parent dir
  // that start with the basename of the partial.
  const dir = dirname(partial);
  const base = basename(partial);
  const absDir = dir === '.' ? cwd : join(cwd, dir);
  const prefix = dir === '.' ? '' : dir + '/';
  return listDir(absDir, prefix, base);
}

/**
 * List entries in a directory, optionally filtered by a name prefix.
 */
function listDir(absDir: string, pathPrefix: string, namePrefix?: string): FileCompletion[] {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }

  // Filter by prefix if provided.
  const filtered = namePrefix
    ? entries.filter((e) => e.startsWith(namePrefix))
    : entries;

  // Sort: directories first, then files, alphabetically.
  const results: FileCompletion[] = [];
  for (const entry of filtered) {
    if (results.length >= MAX_FILE_COMPLETIONS) break;
    try {
      const fullPath = join(absDir, entry);
      const isDir = statSync(fullPath).isDirectory();
      results.push({
        value: pathPrefix + entry,
        isDirectory: isDir,
        label: entry + (isDir ? '/' : ''),
      });
    } catch {
      // Skip entries we can't stat (broken symlinks, permission errors).
    }
  }

  results.sort((a, b) => {
    // Directories first.
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return results;
}
