/**
 * read_file tool (Module 3, part 1).
 *
 * Reads the contents of a file at the given path. Supports optional
 * `offset` (line number to start from, 1-based) and `limit` (max lines
 * to read) for large files.
 *
 * Permission tier: T0 (read-only).
 *
 * @module tools/core/read-file
 */

import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';

import { ToolExecutionError } from '../../utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/** The read_file tool definition. */
export const READ_FILE_TOOL: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a file. Supports offset (1-based line number to start from) ' +
    'and limit (max lines to read) for large files. The file path must be within the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to read (relative to workspace or absolute).',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-based). Default: 1.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Default: 2000.',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
  handler: readFileSyncHandler,
  tier: 'T0',
  readOnly: true,
};

/**
 * The read_file handler.
 * @param args
 * @param ctx
 */
async function readFileSyncHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const offset = (args['offset'] as number | undefined) ?? 1;
  const limit = (args['limit'] as number | undefined) ?? 2000;

  const resolvedPath = resolveUserPath(filePath, ctx.workspaceRoot);

  // Security: block reads outside workspace unless god mode. This check
  // uses realpathSync so symlinks inside the workspace pointing outside
  // (e.g. `/workspace/evil -> /etc/passwd`) are detected and blocked.
  const boundaryCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'read_file');
  }

  // Check it exists and is a file. Distinguish common error codes so the
  // user gets an accurate error message (EACCES, EISDIR, etc.).
  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      throw new ToolExecutionError(`File not found: ${filePath}`, 'read_file');
    }
    if (code === 'EACCES') {
      throw new ToolExecutionError(`Permission denied: ${filePath}`, 'read_file');
    }
    if (code === 'EISDIR') {
      throw new ToolExecutionError(`Not a file (is a directory): ${filePath}`, 'read_file');
    }
    throw new ToolExecutionError(
      `Cannot read file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      'read_file',
    );
  }
  if (!stat.isFile()) {
    throw new ToolExecutionError(`Not a file: ${filePath}`, 'read_file');
  }

  // Read and slice. Avoid the double-split the previous impl did:
  // it split into `lines`, sliced, joined, then split again. We split once.
  const content = readFileSync(resolvedPath, 'utf-8');
  const allLines = content.split('\n');
  const startIdx = Math.max(0, offset - 1);
  const endIdx = Math.min(allLines.length, startIdx + limit);
  const slicedLines = allLines.slice(startIdx, endIdx);

  // Add line number prefix for readability
  const numbered = slicedLines
    .map((line, i) => `${String(startIdx + i + 1).padStart(6)} │ ${line}`)
    .join('\n');

  // Track read files (for Read-before-Edit enforcement in edit_file)
  ctx.readFiles.add(resolvedPath);

  const relPath = relative(ctx.workspaceRoot, resolvedPath);
  const header = `Read ${endIdx - startIdx} lines from ${relPath} (lines ${startIdx + 1}–${endIdx} of ${allLines.length}):\n`;

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: header + numbered,
  };
}
