/**
 * spec_update tool (H13 — Spec-Driven Development).
 *
 * Update an existing spec's content (requirements, acceptance criteria,
 * test plan, implementation notes, or status). The spec must already
 * exist (created via `spec_write`).
 *
 * Common workflow:
 *   1. `spec_write` → status: draft
 *   2. `spec_review` with `request_changes` → status: draft (with feedback)
 *   3. `spec_update` → revise the content
 *   4. `spec_review` with `approve` → status: approved
 *   5. `edit_file`/`write_file` proceed (in --spec-mode)
 *   6. `spec_update` with status: 'implemented' → mark as done
 *
 * Permission tier: T1 (writes the spec markdown file).
 *
 * @module tools/core/spec-update
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { relative } from 'node:path';

import { ToolExecutionError } from '@goli-cli/shared/utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';
import { specRegistry, renderSpecMarkdown, type SpecStatus } from './spec-registry.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const SPEC_UPDATE_TOOL: Tool = {
  name: 'spec_update',
  description:
    'Update an existing spec (created by spec_write). Can revise requirements, acceptance ' +
    'criteria, test plan, implementation notes, or status. The spec markdown file is re-written ' +
    'with the new content. Use this after spec_review with request_changes, or to mark a spec ' +
    'as implemented after the work is done.',
  inputSchema: {
    type: 'object',
    properties: {
      spec_path: {
        type: 'string',
        description: 'Path to the spec markdown file (must match the path used in spec_write).',
      },
      requirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'New requirements (replaces the existing list).',
      },
      acceptance_criteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'New acceptance criteria (replaces the existing list).',
      },
      test_plan: {
        type: 'array',
        items: { type: 'string' },
        description: 'New test plan (replaces the existing list).',
      },
      implementation_notes: {
        type: 'string',
        description: 'New implementation notes (replaces the existing text).',
      },
      status: {
        type: 'string',
        enum: ['draft', 'approved', 'rejected', 'implemented'],
        description: 'New status. Use \'implemented\' to mark the spec as done after the work is complete.',
      },
    },
    required: ['spec_path'],
    additionalProperties: false,
  },
  handler: specUpdateHandler,
  tier: 'T1',
  readOnly: false,
};

async function specUpdateHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const specPathArg = args['spec_path'] as string;
  const resolvedSpecPath = resolveUserPath(specPathArg, ctx.workspaceRoot);

  // Boundary check (workspace escape defense).
  const boundaryCheck = checkPathInWorkspace(resolvedSpecPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'spec_update');
  }

  const spec = specRegistry.get(resolvedSpecPath);
  if (!spec) {
    throw new ToolExecutionError(
      `Spec not found: ${specPathArg}. Call spec_write first.`,
      'spec_update',
    );
  }

  // Build the updates object (only fields that were provided).
  const updates: {
    requirements?: string[];
    acceptanceCriteria?: string[];
    testPlan?: string[];
    implementationNotes?: string;
    status?: SpecStatus;
  } = {};

  if (args['requirements'] !== undefined) {
    const reqs = args['requirements'];
    if (!Array.isArray(reqs)) {
      throw new ToolExecutionError('requirements must be an array', 'spec_update');
    }
    updates.requirements = reqs as string[];
  }
  if (args['acceptance_criteria'] !== undefined) {
    const ac = args['acceptance_criteria'];
    if (!Array.isArray(ac)) {
      throw new ToolExecutionError('acceptance_criteria must be an array', 'spec_update');
    }
    updates.acceptanceCriteria = ac as string[];
  }
  if (args['test_plan'] !== undefined) {
    const tp = args['test_plan'];
    if (!Array.isArray(tp)) {
      throw new ToolExecutionError('test_plan must be an array', 'spec_update');
    }
    updates.testPlan = tp as string[];
  }
  if (args['implementation_notes'] !== undefined) {
    updates.implementationNotes = args['implementation_notes'] as string;
  }
  if (args['status'] !== undefined) {
    const status = args['status'] as SpecStatus;
    if (!['draft', 'approved', 'rejected', 'implemented'].includes(status)) {
      throw new ToolExecutionError(
        `Invalid status: ${status}. Must be 'draft', 'approved', 'rejected', or 'implemented'.`,
        'spec_update',
      );
    }
    updates.status = status;
  }

  const updated = specRegistry.update(resolvedSpecPath, updates);

  // Re-write the markdown file using an atomic temp-file + rename
  // pattern (consistent with write_file/edit_file — MEDIUM-21). The
  // previous implementation called `writeFileSync` directly, which
  // truncates the file before writing — a crash mid-write leaves a
  // partial spec on disk that the next session can't parse.
  const tempPath = `${resolvedSpecPath}.goli-tmp-${randomUUID().slice(0, 8)}`;
  try {
    const markdown = renderSpecMarkdown(updated);
    writeFileSync(tempPath, markdown, 'utf-8');
    try {
      renameSync(tempPath, resolvedSpecPath);
    } catch (err) {
      try { unlinkSync(tempPath); } catch { /* best-effort */ }
      throw err;
    }
  } catch (err) {
    throw new ToolExecutionError(
      `Failed to update spec file ${specPathArg}: ${err instanceof Error ? err.message : String(err)}`,
      'spec_update',
    );
  }

  const relPath = relative(ctx.workspaceRoot, resolvedSpecPath);
  const changedFields = Object.keys(updates).join(', ');
  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: `Spec updated: ${relPath}. Changed: ${changedFields}. Current status: ${updated.status}.`,
  };
}
