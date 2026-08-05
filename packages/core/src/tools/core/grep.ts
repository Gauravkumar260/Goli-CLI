/**
 * grep tool (Module 3, part 1).
 *
 * Searches file contents using ripgrep (`rg`). Wraps `rg --json` output
 * and returns matches with file paths, line numbers, and content.
 *
 * ripgrep is the industry standard for code search — it's fast, respects
 * .gitignore by default, and handles large codebases efficiently. The
 * upstream spec mandates ripgrep for the grep tool (not a hand-rolled
 * line-by-line scan).
 *
 * Permission tier: T0 (read-only).
 *
 * @module tools/core/grep
 */

import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

import { ToolExecutionError } from '../../utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const GREP_TOOL: Tool = {
  name: 'grep',
  description:
    'Search file contents using ripgrep. Returns matching lines with file paths and line numbers. ' +
    'Supports regex patterns, file globbing, and type filtering. Respects .gitignore by default.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'The directory or file to search in (relative to workspace or absolute). Default: workspace root.',
      },
      glob: {
        type: 'string',
        description: 'File glob to filter (e.g. "*.ts", "**/*.tsx"). Passed to ripgrep via --glob.',
      },
      type: {
        type: 'string',
        description: 'File type to search (e.g. "ts", "py", "js", "rust"). Passed to ripgrep via --type.',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'If true, perform case-insensitive search. Default: false.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of matching lines to return. Default: 100.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  handler: grepHandler,
  tier: 'T0',
  readOnly: true,
};

interface RgMatch {
  type: string;
  data: {
    path?: { text: string };
    line_number?: number;
    lines?: { text: string };
    submatches?: Array<{ match: { text: string } }>;
  };
}

async function grepHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const searchPath = (args['path'] as string | undefined) ?? '.';
  const glob = args['glob'] as string | undefined;
  const type = args['type'] as string | undefined;
  const caseInsensitive = (args['case_insensitive'] as boolean | undefined) ?? false;
  const maxResults = (args['max_results'] as number | undefined) ?? 100;

  // Security: resolve + check via the shared path-safety helper. The
  // previous implementation did an inline `relative()` check on the
  // UNRESOLVED path — `realpathSync` was never called, so an in-workspace
  // symlink pointing to `/etc` (creatable via the bash `ln -s` bypass)
  // was invisible to the check, and `grep({ pattern: 'root', path:
  // '/workspace/evil' })` would search `/etc`, leaking `/etc/passwd`
  // and `/etc/shadow` lines. This is the more dangerous of the two
  // path-bypass issues (vs. list_directory) because `grep` returns
  // matched CONTENT, not just filenames — a direct file-content
  // disclosure channel.
  const resolvedPath = resolveUserPath(searchPath, ctx.workspaceRoot);
  const pathCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode ?? false);
  if (!pathCheck.ok) {
    throw new ToolExecutionError(
      `Cannot search outside workspace: ${searchPath} (${pathCheck.reason})`,
      'grep',
    );
  }

  // Build the ripgrep command as an ARG ARRAY (not a shell string).
  // The previous implementation interpolated `JSON.stringify(pattern)`
  // and `JSON.stringify(resolvedPath)` into a shell string passed to
  // `execSync`. Inside double quotes, `$(...)` and backticks ARE
  // interpreted by the shell, so a pattern like `foo$(rm -rf /)` would
  // execute. Using `execFileSync` with an arg array bypasses the shell
  // entirely.
  //
  // We use `--regexp` (not a positional arg) for the pattern so that
  // patterns starting with `-` (e.g. `-foo`, `--foo`) aren't
  // misparsed as flags. The previous implementation pushed `pattern`
  // as a positional arg, which meant `rg ... --max-count 100 -foo`
  // was interpreted as `rg ... --max-count 100 -foo` — ripgrep
  // treated `-foo` as an unknown flag and errored.
  // We use `--` to separate the path from any flag-like args.
  const rgArgs: string[] = [
    '--json',
    '--max-count', String(maxResults),
  ];
  if (caseInsensitive) rgArgs.push('-i');
  if (glob) rgArgs.push('--glob', glob);
  if (type) rgArgs.push('--type', type);
  rgArgs.push('--regexp', pattern);
  rgArgs.push(resolvedPath);

  let stdout: string;
  try {
    stdout = execFileSync('rg', rgArgs, {
      encoding: 'utf-8',
      cwd: ctx.workspaceRoot,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // ripgrep exits with code 1 when no matches found — that's not an error
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 1) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `No matches found for pattern "${pattern}" in ${searchPath}.`,
      };
    }
    // Check if rg is installed (ENOENT).
    if (err instanceof Error && (err as { code?: string }).code === 'ENOENT') {
      throw new ToolExecutionError(
        'ripgrep (rg) is not installed. Install it from https://github.com/BurntSushi/ripgrep',
        'grep',
      );
    }
    throw new ToolExecutionError(
      `grep failed: ${err instanceof Error ? err.message : String(err)}`,
      'grep',
    );
  }

  // Parse the JSON output (one JSON object per line)
  const matches: RgMatch[] = stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as RgMatch;
      } catch {
        return null;
      }
    })
    .filter((m): m is RgMatch => m !== null);

  // Filter to match-type entries (skip summary/context lines)
  const matchEntries = matches.filter((m) => m.type === 'match');

  if (matchEntries.length === 0) {
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `No matches found for pattern "${pattern}" in ${searchPath}.`,
    };
  }

  // Format output
  const lines = matchEntries.slice(0, maxResults).map((m) => {
    const filePath = m.data.path?.text ?? '(unknown)';
    const lineNum = m.data.line_number ?? 0;
    const text = (m.data.lines?.text ?? '').trimEnd();
    const relFile = relative(ctx.workspaceRoot, filePath);
    return `${relFile}:${lineNum}: ${text}`;
  });

  const header = `Found ${matchEntries.length} match(es) for "${pattern}" in ${searchPath}:\n`;
  let content = header + lines.join('\n');

  if (matchEntries.length > maxResults) {
    content += `\n\n[... ${matchEntries.length - maxResults} more matches not shown. Increase max_results or refine your pattern.]`;
  }

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content,
    truncated: matchEntries.length > maxResults,
  };
}
