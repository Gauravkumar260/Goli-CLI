/**
 * spec_review tool (H13 — Spec-Driven Development).
 *
 * Review a spec written by `spec_write`. The user (or the agent on
 * behalf of the user) approves, rejects, or requests changes. Once a
 * spec is approved, `edit_file`/`write_file` will proceed (when
 * `--spec-mode` is on).
 *
 * Permission tier: T0 (read-only operation — the review decision is
 * stored in the in-memory registry; the spec file on disk is updated
 * to reflect the new status).
 *
 * @module tools/core/spec-review
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

import { ToolExecutionError } from '../../utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';
import { specRegistry, renderSpecMarkdown, type SpecStatus } from './spec-registry.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/** Review actions the user can take on a spec. */
export type ReviewAction = 'approve' | 'reject' | 'request_changes';

/**
 *
 */
export const SPEC_REVIEW_TOOL: Tool = {
  name: 'spec_review',
  description:
    'Review a spec written by spec_write. Approve to allow edit_file/write_file to proceed in ' +
    '--spec-mode; reject to block implementation; request_changes to ask the agent to revise the spec. ' +
    'The review decision is recorded in the spec file and the in-memory registry.',
  inputSchema: {
    type: 'object',
    properties: {
      spec_path: {
        type: 'string',
        description: 'Path to the spec markdown file (must match the path used in spec_write).',
      },
      action: {
        type: 'string',
        enum: ['approve', 'reject', 'request_changes'],
        description: 'The review action: approve (allow implementation), reject (block), request_changes (ask for revision).',
      },
      feedback: {
        type: 'string',
        description: 'Optional reviewer feedback (required for reject and request_changes).',
      },
    },
    required: ['spec_path', 'action'],
    additionalProperties: false,
  },
  handler: specReviewHandler,
  // The handler writes the rendered spec markdown back to disk (see
  // `writeFileSync(resolvedSpecPath, markdown, 'utf-8')` below). The
  // previous metadata claimed `tier: 'T0'` (auto-approved) and
  // `readOnly: true` (skips diff review), so any routing/approval
  // layer that trusted these flags would silently let the model
  // write spec files without confirmation. We correct to T1 +
  // readOnly=false so the gate treats it as a mutating tool.
  tier: 'T1',
  readOnly: false,
};

async function specReviewHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const specPathArg = args['spec_path'] as string;
  const action = args['action'] as ReviewAction;
  const feedback = args['feedback'] as string | undefined;

  if (!['approve', 'reject', 'request_changes'].includes(action)) {
    throw new ToolExecutionError(
      `Invalid action: ${action}. Must be 'approve', 'reject', or 'request_changes'.`,
      'spec_review',
    );
  }

  if ((action === 'reject' || action === 'request_changes') && !feedback) {
    throw new ToolExecutionError(
      `Feedback is required when action is '${action}'.`,
      'spec_review',
    );
  }

  const resolvedSpecPath = resolveUserPath(specPathArg, ctx.workspaceRoot);

  // Boundary check (workspace escape defense).
  const boundaryCheck = checkPathInWorkspace(resolvedSpecPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'spec_review');
  }

  // Check the in-memory registry first.
  let spec = specRegistry.get(resolvedSpecPath);

  // If not in the registry, try to load from disk (the spec was
  // written in a previous session — note that this will not have
  // the full structured data, only what we can parse from markdown).
  if (!spec) {
    if (!existsSync(resolvedSpecPath)) {
      throw new ToolExecutionError(
        `Spec not found: ${specPathArg}. Call spec_write first.`,
        'spec_review',
      );
    }
    // For now, we require the spec to be in the registry. Cross-session
    // spec review is a follow-up feature.
    throw new ToolExecutionError(
      `Spec ${specPathArg} exists on disk but is not in the in-memory registry. ` +
        `This likely means the spec was written in a previous session. ` +
        `Re-write the spec with spec_write to register it in this session.`,
      'spec_review',
    );
  }

  // Map the review action to a spec status.
  const newStatus: SpecStatus =
    action === 'approve' ? 'approved' :
    action === 'reject' ? 'rejected' :
    'draft'; // request_changes → back to draft

  spec = specRegistry.setStatus(resolvedSpecPath, newStatus, feedback);

  // Re-render and re-write the markdown file atomically (MEDIUM-20).
  // The previous implementation called `writeFileSync` directly,
  // which truncates before writing — a crash mid-write leaves a
  // partial spec on disk. We now use the temp-file + rename pattern
  // (consistent with write_file/edit_file/spec_update).
  try {
    const markdown = renderSpecMarkdown(spec);
    const tempPath = `${resolvedSpecPath}.goli-tmp-${randomUUID().slice(0, 8)}`;
    try {
      writeFileSync(tempPath, markdown, 'utf-8');
      try {
        renameSync(tempPath, resolvedSpecPath);
      } catch (err) {
        try { unlinkSync(tempPath); } catch { /* best-effort */ }
        throw err;
      }
    } catch (err) {
      ctx.logger?.warn('Failed to update spec file on disk', {
        specPath: resolvedSpecPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    // The in-memory registry is updated; the disk write is best-effort.
    // Don't fail the whole review if the disk write fails.
    ctx.logger?.warn('Failed to render spec markdown', {
      specPath: resolvedSpecPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const relPath = relative(ctx.workspaceRoot, resolvedSpecPath);
  const message =
    action === 'approve'
      ? `Spec approved: ${relPath}. edit_file/write_file may now proceed (in --spec-mode).`
      : action === 'reject'
      ? `Spec rejected: ${relPath}. edit_file/write_file will be blocked (in --spec-mode) until the spec is revised and re-approved.`
      : `Spec sent back for changes: ${relPath}. The agent should revise the spec and re-submit.`;

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: message + (feedback ? `\nFeedback: ${feedback}` : ''),
  };
}
