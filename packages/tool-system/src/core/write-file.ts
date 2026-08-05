/**
 * write_file tool (Module 3, part 1).
 *
 * Writes content to a file (creates or overwrites). Uses atomic write
 * (temp file + rename) to prevent partial writes on crash.
 *
 * ## Diff-first editing (H14, ADR-0037)
 *
 * When `ToolContext.requestDiffApproval` is set (TUI mode or headless
 * with `--diff-review`), the tool computes the diff between the
 * existing file content (empty for new files) and the proposed content,
 * then calls the approval callback BEFORE writing. If the user rejects,
 * the file is NOT modified.
 *
 * Permission tier: T1 (file writes).
 *
 * @module tools/core/write-file
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, renameSync, statSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { computeBlastRadius, DEFAULT_BLAST_RADIUS_CONFIG } from '@goli-cli/approval';
import { ToolExecutionError } from '@goli-cli/shared/utils/errors.js';

import { checkSingleEntryDiffApproval } from './diff-approval.js';
import { buildDiffEntry, formatDiffAsString } from './diff-utils.js';
import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';
import { specRegistry } from './spec-registry.js';
// P1-10 fix (verification report deferred item #2): wire blast-radius
// into the write_file approval flow (only fires when OVERWRITING an
// existing file — new-file creation is always allowed). See edit-file.ts
// for the full rationale.

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const WRITE_FILE_TOOL: Tool = {
  name: 'write_file',
  description:
    'Write content to a file (creates or overwrites). The file path must be within the workspace. ' +
    'Use edit_file for targeted changes to existing files; use write_file only for new files or full rewrites. ' +
    'In diff-review mode, the proposed content is shown to the user before it is applied.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to write (relative to workspace or absolute).',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file.',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  },
  handler: writeFileHandler,
  tier: 'T1',
  readOnly: false,
};

async function writeFileHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const filePath = args['file_path'] as string;
  const content = args['content'] as string;

  const resolvedPath = resolveUserPath(filePath, ctx.workspaceRoot);

  // Security: block writes outside workspace unless god mode. Uses
  // realpathSync (when the file exists) so in-workspace symlinks pointing
  // outside are blocked. For new files, only the resolved path is checked.
  const boundaryCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'write_file');
  }

  // Read-only sandbox check
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    throw new ToolExecutionError(
      `Cannot write in read-only sandbox mode`,
      'write_file',
    );
  }

  // Spec-mode gating (H13, ADR-0038)
  if (ctx.specMode && !ctx.godMode && !specRegistry.hasApprovedSpec()) {
    throw new ToolExecutionError(
      `Cannot write in --spec-mode: no approved spec. Call spec_write to draft a spec, ` +
        `then spec_review with action='approve' to approve it before writing files.`,
      'write_file',
    );
  }

  // Read the existing content (if any) for diff computation.
  let oldContent = '';
  let prevMode: number | undefined;
  // Track whether the file existed BEFORE the write — used for the
  // action label. The previous implementation used
  // `existsSync(resolvedPath) && oldContent` AFTER the write, which
  // incorrectly reported overwrite-of-empty-file as 'created' (an
  // empty file has `oldContent === ''` which is falsy).
  let fileExistedBefore = false;
  try {
    oldContent = readFileSync(resolvedPath, 'utf-8');
    prevMode = statSync(resolvedPath).mode & 0o777;
    fileExistedBefore = true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENOENT') {
      // EACCES, EISDIR, etc. — surface as an error.
      throw new ToolExecutionError(
        `Cannot read existing file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        'write_file',
      );
    }
    // File doesn't exist yet — oldContent stays '' and prevMode stays undefined.
  }

  // P1-10 fix: Blast-radius guard (only when OVERWRITING an existing
  // file — new-file creation is always allowed since there's no "old
  // content" to compare). Blocks overwrites that delete or add too
  // many lines, preventing accidental large rewrites. Skipped in
  // godMode. Runs BEFORE the diff-approval gate so the user never
  // sees a diff for an edit that would be blocked anyway.
  if (!ctx.godMode && fileExistedBefore && oldContent.length > 0) {
    const blastResult = computeBlastRadius(oldContent, content, DEFAULT_BLAST_RADIUS_CONFIG);
    if (!blastResult.allowed) {
      throw new ToolExecutionError(
        `write_file blocked by blast-radius guard: ${blastResult.reason ?? 'threshold exceeded'} ` +
        `(${blastResult.deletedLines} deleted, ${blastResult.addedLines} added of ${blastResult.totalLines} total lines). ` +
        `If this is an intentional full rewrite, run in god mode.`,
        'write_file',
      );
    }
  }

  // ─── Diff-first approval (H14) ──────────────────────────────
  if (ctx.requestDiffApproval && !ctx.diffReviewDisabled) {
    const entry = buildDiffEntry(resolvedPath, 'write_file', oldContent, content);
    // Skip the approval round-trip if the content is identical (no-op write).
    if (entry.diffLines.length > 0) {
      const approvalCheck = await checkSingleEntryDiffApproval(ctx, entry, 'write', filePath);
      if (!approvalCheck.accepted) {
        return approvalCheck.rejection;
      }
    }
  } else if (ctx.requestApproval && !ctx.godMode && !ctx.autoMode) {
    // P1-3 fix (audit Finding CC-2): PRE-EXECUTION approval gate for
    // write_file when diff-review is not active. In build mode, T1
    // file writes must prompt the user BEFORE the atomic write. When
    // `requestApproval` is undefined (headless without approver), we
    // fall through and write directly — preserving the original
    // headless behavior (the caller can use --auto or --god, or the
    // --diff-review flag for headless diff review). This branch only
    // fires when an interactive approver IS wired (TUI mode) but diff
    // review is OFF — the user gets a simple yes/no/always prompt
    // instead of a per-file diff review.
    const sizeLabel = content.length > 1024
      ? `${(content.length / 1024).toFixed(1)} KB`
      : `${content.length} bytes`;
    const approvalDecision = await ctx.requestApproval({
      toolCallId: ctx.toolCallId,
      toolName: 'write_file',
      tier: 'T1',
      description: `${fileExistedBefore ? 'overwrite' : 'create'} ${filePath} (${sizeLabel})`,
      args: { file_path: filePath, content },
      timestamp: new Date().toISOString(),
      // P0-3 fix (remediation plan Phase 3): populate `diffEntry` so
      // the TUI's `DiffReviewDialog` can render the proposed write
      // before the user approves. `oldContent` is the current file
      // content (empty string for new files — `fileExistedBefore`
      // was checked above); `content` is the new content to write.
      diffEntry: {
        filePath,
        tool: 'write_file',
        oldContent,
        newContent: content,
      },
    });
    if (!approvalDecision.approved) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `write_file denied by user${approvalDecision.reason ? `: ${approvalDecision.reason}` : ''}. Path: ${filePath}`,
      };
    }
  }

  // Ensure parent directory exists. mkdirSync with `recursive: true` is
  // idempotent (doesn't throw if the dir already exists), so the previous
  // existsSync check was a TOCTOU race — just call mkdirSync directly.
  const parentDir = dirname(resolvedPath);
  try {
    mkdirSync(parentDir, { recursive: true });
  } catch (err) {
    throw new ToolExecutionError(
      `Failed to create parent directory ${parentDir}: ${err instanceof Error ? err.message : String(err)}`,
      'write_file',
    );
  }

  // Atomic write: write to temp file, then rename. Preserve permissions
  // if the file already exists (an executable script should stay
  // executable after a full rewrite). Clean up the temp file on failure.
  const tempPath = resolvedPath + `.goli-tmp-${randomUUID().slice(0, 8)}`;
  try {
    writeFileSync(tempPath, content, 'utf-8');
    if (prevMode !== undefined) {
      try {
        chmodSync(tempPath, prevMode);
      } catch {
        // Best-effort.
      }
    }
    renameSync(tempPath, resolvedPath);
  } catch (err) {
    // Clean up the temp file if rename failed.
    try { unlinkSync(tempPath); } catch { /* best-effort */ }
    throw new ToolExecutionError(
      `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      'write_file',
    );
  }

  const relPath = relative(ctx.workspaceRoot, resolvedPath);
  // For empty content, report 0 lines (not 1 — the previous impl's
  // `''.split('\n').length === 1` was misleading).
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;

  // Include the diff in the result when diff review was NOT used
  // (headless / autoMode) so the caller can see what changed.
  const diffSummary = (!ctx.requestDiffApproval || ctx.diffReviewDisabled) && oldContent !== content
    ? `\n${formatDiffAsString(buildDiffEntry(resolvedPath, 'write_file', oldContent, content))}`
    : '';

  const action = fileExistedBefore ? 'overwrote' : 'created';
  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: `Successfully ${action} ${relPath} with ${lineCount} lines.${diffSummary}`,
  };
}
