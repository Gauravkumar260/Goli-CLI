/**
 * list_directory tool (Module 3, part 1).
 *
 * Lists the contents of a directory. Respects `.gitignore` (skips
 * ignored files/directories like `node_modules/`, `dist/`, `.git/`).
 *
 * Permission tier: T0 (read-only).
 *
 * @module tools/core/list-directory
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { relative, join } from 'node:path';

import { ToolExecutionError } from '../../utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const LIST_DIRECTORY_TOOL: Tool = {
  name: 'list_directory',
  description:
    'List the contents of a directory. Respects .gitignore (skips node_modules, dist, .git, etc.). ' +
    'Returns entries with type indicators: / for directories, nothing for files.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (relative to workspace or absolute). Default: workspace root.',
      },
      max_entries: {
        type: 'number',
        description: 'Maximum number of entries to return. Default: 200.',
      },
    },
    additionalProperties: false,
  },
  handler: listDirectoryHandler,
  tier: 'T0',
  readOnly: true,
};

/** Directories always skipped (even without .gitignore). */
const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
  '.turbo',
]);

async function listDirectoryHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const dirPath = (args['path'] as string | undefined) ?? '.';
  const maxEntries = (args['max_entries'] as number | undefined) ?? 200;

  // Security: resolve + check via the shared path-safety helper. The
  // previous implementation did an inline `relative()` check on the
  // UNRESOLVED path — `realpathSync` was never called, so an in-workspace
  // symlink pointing to `/etc` (creatable via the bash `ln -s` bypass
  // — see bash.ts Cross-File Issues) was invisible to the check, and
  // `list_directory('/workspace/evil-symlink-to-etc')` would list `/etc`.
  const resolvedPath = resolveUserPath(dirPath, ctx.workspaceRoot);
  const pathCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode ?? false);
  if (!pathCheck.ok) {
    throw new ToolExecutionError(
      `Cannot list directory outside workspace: ${dirPath} (${pathCheck.reason})`,
      'list_directory',
    );
  }

  // Check it exists and is a directory
  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch {
    throw new ToolExecutionError(`Directory not found: ${dirPath}`, 'list_directory');
  }
  if (!stat.isDirectory()) {
    throw new ToolExecutionError(`Not a directory: ${dirPath}`, 'list_directory');
  }

  // Read .gitignore if present
  const gitignorePath = join(resolvedPath, '.gitignore');
  const ignorePatterns = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
    : [];

  // List entries
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = readdirSync(resolvedPath)
      .filter((name) => !ALWAYS_SKIP.has(name))
      .filter((name) => !ignorePatterns.some((p) => name.startsWith(p.replace('*', ''))))
      .map((name) => {
        const full = join(resolvedPath, name);
        try {
          return { name, isDir: statSync(full).isDirectory() };
        } catch {
          return { name, isDir: false };
        }
      })
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    throw new ToolExecutionError(
      `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`,
      'list_directory',
    );
  }

  const total = entries.length;
  const truncated = total > maxEntries;
  const shown = entries.slice(0, maxEntries);

  const relPath = relative(ctx.workspaceRoot, resolvedPath);
  const lines = shown.map((e) => `${e.isDir ? '📁' : '📄'} ${e.name}${e.isDir ? '/' : ''}`);
  const header = `Listing ${relPath} (${Math.min(total, maxEntries)} of ${total} entries):\n`;

  let content = header + lines.join('\n');
  if (truncated) {
    content += `\n\n[... ${total - maxEntries} more entries not shown. Increase max_entries or use grep to search.]`;
  }

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content,
    truncated,
  };
}
