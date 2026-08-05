/**
 * edit_file tool (Module 3, part 1).
 *
 * Performs exact-match search-and-replace on an existing file. The
 * `old_string` must be UNIQUE in the file (otherwise the edit is
 * ambiguous). Set `replace_all: true` to replace all occurrences.
 *
 * ## Read-before-Edit enforcement
 *
 * The agent MUST read a file before editing it. This prevents blind
 * edits to files the agent hasn't seen. The registry tracks read files
 * in the ToolContext; edit_file refuses to edit unread files.
 *
 * **Caveat**: compaction (Phase 7) wipes this tracking — the agent
 * must re-read after compaction.
 *
 * ## Why old_string/new_string (not unified diffs)?
 *
 * Claude Code deliberately uses exact-match search-and-replace; models
 * are trained on it; uniqueness enforcement prevents ambiguous edits;
 * diffs fail on whitespace mismatches. (ADR-0014)
 *
 * ## Diff-first editing (H14, ADR-0037)
 *
 * When `ToolContext.requestDiffApproval` is set (TUI mode or headless
 * with `--diff-review`), the tool computes the proposed new content
 * WITHOUT writing, builds a `DiffEntry`, and calls the approval
 * callback. If the user rejects the diff, the file is NOT modified.
 * If accepted, the atomic write proceeds as before. When the callback
 * is undefined (default headless mode), the tool writes directly —
 * preserving the original behavior for scripts and CI.
 *
 * Permission tier: T1 (file writes).
 *
 * @module tools/core/edit-file
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, statSync, chmodSync, unlinkSync } from 'node:fs';
import { relative } from 'node:path';

import { computeBlastRadius, DEFAULT_BLAST_RADIUS_CONFIG } from '@goli-cli/approval';
import { ToolExecutionError } from '@goli-cli/shared/utils/errors.js';

import { checkSingleEntryDiffApproval } from './diff-approval.js';
import { buildDiffEntry, formatDiffAsString } from './diff-utils.js';
import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';
import { specRegistry } from './spec-registry.js';
// P1-10 fix (verification report deferred item #2): wire blast-radius
// into the edit_file approval flow. computeBlastRadius() was fully
// implemented (multiplicity-aware diff, deletion + addition guards) but
// had zero production callers — the verification report flagged it as
// dead code. We now call it after computing newContent and before the
// diff-approval/requestApproval gate. If the blast radius exceeds the
// configured thresholds, the edit is blocked with a clear reason,
// preventing the agent from accidentally deleting large portions of
// files or injecting large payloads (backdoors, minified scripts).
// Skipped in godMode (explicit user consent to bypass all safety).

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const EDIT_FILE_TOOL: Tool = {
  name: 'edit_file',
  description:
    'Edit an existing file by replacing old_string with new_string. The old_string must be ' +
    'unique in the file (unless replace_all is true). You MUST read the file first with read_file ' +
    'before editing it. Use this for targeted changes; use write_file for full rewrites. ' +
    'In diff-review mode, the proposed change is shown to the user before it is applied.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to edit.',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to search for in the file. Must be unique unless replace_all is true.',
      },
      new_string: {
        type: 'string',
        description: 'The string to replace old_string with.',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace ALL occurrences of old_string. Default: false.',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  handler: editFileHandler,
  tier: 'T1',
  readOnly: false,
};

async function editFileHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const oldString = args['old_string'] as string;
  const newString = args['new_string'] as string;
  const replaceAll = (args['replace_all'] as boolean | undefined) ?? false;

  const resolvedPath = resolveUserPath(filePath, ctx.workspaceRoot);

  // Security: block writes outside workspace unless god mode. Uses
  // realpathSync so in-workspace symlinks pointing outside are blocked.
  const boundaryCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'edit_file');
  }
  // Use the realpath (symlink-resolved) for the readFiles tracking
  // set — the previous implementation used the resolved-but-not-
  // symlink-resolved path, so reading `/workspace/link` (a symlink
  // to `/workspace/real`) tracked `/workspace/link`, but editing
  // `/workspace/real` then failed the Read-before-Edit check
  // because `/workspace/real` wasn't in the set.
  const trackedPath = boundaryCheck.realPath ?? resolvedPath;

  // Read-only sandbox check
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    throw new ToolExecutionError(
      `Cannot edit in read-only sandbox mode`,
      'edit_file',
    );
  }

  // Spec-mode gating (H13, ADR-0038)
  if (ctx.specMode && !ctx.godMode && !specRegistry.hasApprovedSpec()) {
    throw new ToolExecutionError(
      `Cannot edit in --spec-mode: no approved spec. Call spec_write to draft a spec, ` +
        `then spec_review with action='approve' to approve it before editing files.`,
      'edit_file',
    );
  }

  // Read-before-Edit enforcement
  if (!ctx.godMode && !ctx.readFiles.has(trackedPath)) {
    throw new ToolExecutionError(
      `Cannot edit file without reading it first: ${filePath}. Call read_file on this file before editing.`,
      'edit_file',
    );
  }

  // Read the current content
  let content: string;
  try {
    content = readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      throw new ToolExecutionError(`File not found: ${filePath}`, 'edit_file');
    }
    if (code === 'EACCES') {
      throw new ToolExecutionError(`Permission denied: ${filePath}`, 'edit_file');
    }
    throw new ToolExecutionError(
      `Cannot read file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      'edit_file',
    );
  }

  // Count occurrences
  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0) {
    throw new ToolExecutionError(
      `old_string not found in ${filePath}. Make sure the string matches exactly (including whitespace).`,
      'edit_file',
    );
  }

  if (occurrences > 1 && !replaceAll) {
    throw new ToolExecutionError(
      `old_string appears ${occurrences} times in ${filePath}. Set replace_all: true to replace all, or provide a more specific old_string that is unique.`,
      'edit_file',
    );
  }

  // Perform the replacement (in memory only — write is deferred until
  // diff review approves, or proceeds immediately if no callback).
  let newContent: string;
  if (replaceAll) {
    newContent = content.split(oldString).join(newString);
  } else {
    // Replace only the first occurrence
    const idx = content.indexOf(oldString);
    newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  }

  // P1-10 fix: Blast-radius guard. Compute the diff between old and
  // new content and block if the deletion/addition exceeds configured
  // thresholds. This prevents the agent from accidentally deleting
  // large portions of files or injecting large payloads. Skipped in
  // godMode (explicit user consent to bypass all safety) and for
  // files below minLinesToEnforce (default 10 — tiny files are
  // exempt). The guard runs BEFORE the diff-approval gate so the
  // user never sees a diff for an edit that would be blocked anyway.
  if (!ctx.godMode) {
    const blastResult = computeBlastRadius(content, newContent, DEFAULT_BLAST_RADIUS_CONFIG);
    if (!blastResult.allowed) {
      throw new ToolExecutionError(
        `edit_file blocked by blast-radius guard: ${blastResult.reason ?? 'threshold exceeded'} ` +
        `(${blastResult.deletedLines} deleted, ${blastResult.addedLines} added of ${blastResult.totalLines} total lines). ` +
        `If this is an intentional large refactor, use write_file (full rewrite) or run in god mode.`,
        'edit_file',
      );
    }
  }

  // ─── Diff-first approval (H14) ──────────────────────────────
  // If a diff-approval callback is registered (TUI mode or headless
  // --diff-review), surface the proposed change BEFORE touching the
  // filesystem. If the user rejects, return without writing.
  if (ctx.requestDiffApproval && !ctx.diffReviewDisabled) {
    const entry = buildDiffEntry(resolvedPath, 'edit_file', content, newContent);
    const approvalCheck = await checkSingleEntryDiffApproval(ctx, entry, 'edit', filePath);
    if (!approvalCheck.accepted) {
      return approvalCheck.rejection;
    }
  } else if (ctx.requestApproval && !ctx.godMode && !ctx.autoMode) {
    // P1-3 fix (audit Finding CC-2): PRE-EXECUTION approval gate for
    // edit_file when diff-review is not active. Mirrors write_file.
    // P0-3 fix (remediation plan Phase 3): populate `diffEntry` so the
    // TUI's `DiffReviewDialog` can render the proposed change before
    // the user approves. `content` is the current file content (read
    // above); `newContent` is the content after the edit is applied.
    const approvalDecision = await ctx.requestApproval({
      toolCallId: ctx.toolCallId,
      toolName: 'edit_file',
      tier: 'T1',
      description: `edit ${filePath} (${oldString.length} chars → ${newString.length} chars${replaceAll ? ', all occurrences' : ''})`,
      args: { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll },
      timestamp: new Date().toISOString(),
      diffEntry: {
        filePath,
        tool: 'edit_file',
        oldContent: content,
        newContent,
      },
    });
    if (!approvalDecision.approved) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `edit_file denied by user${approvalDecision.reason ? `: ${approvalDecision.reason}` : ''}. Path: ${filePath}`,
      };
    }
  }

  // Atomic write. Preserve file permissions (an executable script
  // should stay executable after edit). Clean up the temp file on failure.
  let prevMode: number | undefined;
  try {
    prevMode = statSync(resolvedPath).mode & 0o777;
  } catch {
    // Permissions will default to umask.
  }
  const tempPath = resolvedPath + `.goli-tmp-${randomUUID().slice(0, 8)}`;
  try {
    writeFileSync(tempPath, newContent, 'utf-8');
    if (prevMode !== undefined) {
      try {
        chmodSync(tempPath, prevMode);
      } catch {
        // Best-effort — chmod can fail on some filesystems.
      }
    }
    renameSync(tempPath, resolvedPath);
  } catch (err) {
    // Clean up the temp file if rename failed.
    try { unlinkSync(tempPath); } catch { /* best-effort */ }
    throw new ToolExecutionError(
      `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      'edit_file',
    );
  }

  const relPath = relative(ctx.workspaceRoot, resolvedPath);
  const replaceCount = replaceAll ? occurrences : 1;

  // Build the result content. Include the diff if diff review was
  // bypassed (autoMode or headless) so the user/agent can see what
  // changed. When review was used, the diff was already shown to the
  // user — no need to repeat it in the tool result.
  const diffSummary = (!ctx.requestDiffApproval || ctx.diffReviewDisabled)
    ? `\n${formatDiffAsString(buildDiffEntry(resolvedPath, 'edit_file', content, newContent))}`
    : '';

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: `Successfully edited ${relPath}: replaced ${replaceCount} occurrence(s) of old_string with new_string.${diffSummary}`,
  };
}

/**
 * Count non-overlapping occurrences of a substring.
 * @param haystack
 * @param needle
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
