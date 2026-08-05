/**
 * spec_write tool (H13 — Spec-Driven Development).
 *
 * Writes a formal specification document to disk and registers it in
 * the in-memory {@link SpecRegistry}. The spec starts in `draft`
 * status; the user must approve it via `spec_review` before
 * `edit_file`/`write_file` will proceed (when `--spec-mode` is on).
 *
 * ## Spec format
 *
 * The spec is written as markdown with these sections:
 * - Status (draft / approved / rejected / implemented)
 * - Requirements (functional)
 * - Acceptance Criteria (used to verify the implementation)
 * - Test Plan (how to verify)
 * - Implementation Notes (free-form)
 *
 * ## Path validation
 *
 * The spec path must be within the workspace. The `.goli/specs/`
 * directory is the recommended convention but any workspace path is
 * accepted.
 *
 * Permission tier: T1 (file writes — the spec is a markdown file).
 *
 * @module tools/core/spec-write
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { ToolExecutionError } from '@goli-cli/shared/utils/errors.js';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';
import {
  specRegistry,
  newSpecId,
  deriveTitle,
  renderSpecMarkdown,
  type Spec,
} from './spec-registry.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const SPEC_WRITE_TOOL: Tool = {
  name: 'spec_write',
  description:
    'Write a formal specification document for the current task. The spec is saved as markdown ' +
    'and registered in draft status. The user must approve it (via spec_review) before ' +
    'edit_file/write_file will proceed in --spec-mode. Use this for complex tasks that need ' +
    'upfront design: features, refactors, bug fixes with non-obvious solutions.',
  inputSchema: {
    type: 'object',
    properties: {
      spec_path: {
        type: 'string',
        description: 'Path to the spec markdown file (e.g., ".goli/specs/feature-x.md"). Must be within the workspace.',
      },
      requirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Functional requirements — what the implementation must do.',
      },
      acceptance_criteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Acceptance criteria — verifiable statements that must be true for the implementation to be considered complete.',
      },
      test_plan: {
        type: 'array',
        items: { type: 'string' },
        description: 'Test plan — how to verify the implementation meets the acceptance criteria.',
      },
      implementation_notes: {
        type: 'string',
        description: 'Optional free-form implementation notes (architecture, trade-offs, etc.).',
      },
    },
    required: ['spec_path', 'requirements', 'acceptance_criteria'],
    additionalProperties: false,
  },
  handler: specWriteHandler,
  tier: 'T1',
  readOnly: false,
};

async function specWriteHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const specPathArg = args['spec_path'] as string;
  const requirements = args['requirements'] as string[];
  const acceptanceCriteria = args['acceptance_criteria'] as string[];
  const testPlan = (args['test_plan'] as string[] | undefined) ?? [];
  const implementationNotes = args['implementation_notes'] as string | undefined;

  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new ToolExecutionError('spec_write requires at least one requirement', 'spec_write');
  }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    throw new ToolExecutionError('spec_write requires at least one acceptance criterion', 'spec_write');
  }

  const resolvedSpecPath = resolveUserPath(specPathArg, ctx.workspaceRoot);

  // Security: spec path must be within workspace.
  const boundaryCheck = checkPathInWorkspace(resolvedSpecPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    throw new ToolExecutionError(boundaryCheck.reason, 'spec_write');
  }

  // Read-only sandbox check
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    throw new ToolExecutionError('Cannot write spec in read-only sandbox mode', 'spec_write');
  }

  // Build the spec object
  const now = new Date().toISOString();
  const spec: Spec = {
    id: newSpecId(),
    specPath: resolvedSpecPath,
    title: deriveTitle(resolvedSpecPath),
    requirements,
    acceptanceCriteria,
    testPlan,
    implementationNotes,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // Ensure parent directory exists
  const parentDir = dirname(resolvedSpecPath);
  try {
    mkdirSync(parentDir, { recursive: true });
  } catch (err) {
    throw new ToolExecutionError(
      `Failed to create spec directory ${parentDir}: ${err instanceof Error ? err.message : String(err)}`,
      'spec_write',
    );
  }

  // Write the markdown
  const markdown = renderSpecMarkdown(spec);
  try {
    writeFileSync(resolvedSpecPath, markdown, 'utf-8');
  } catch (err) {
    throw new ToolExecutionError(
      `Failed to write spec ${specPathArg}: ${err instanceof Error ? err.message : String(err)}`,
      'spec_write',
    );
  }

  // Register in the in-memory registry. If a spec at this path already
  // exists (e.g., the agent is re-writing a draft), update it instead
  // of throwing — this is the common workflow.
  const existing = specRegistry.get(resolvedSpecPath);
  if (existing) {
    specRegistry.update(resolvedSpecPath, {
      requirements,
      acceptanceCriteria,
      testPlan,
      implementationNotes,
      // Reset status to 'draft' on re-write (the user must re-approve).
      status: 'draft',
    });
  } else {
    specRegistry.register(spec);
  }

  const relPath = relative(ctx.workspaceRoot, resolvedSpecPath);
  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content:
      `Spec written to ${relPath} (status: draft).\n` +
      `Requirements: ${requirements.length}\n` +
      `Acceptance Criteria: ${acceptanceCriteria.length}\n` +
      `Test Plan: ${testPlan.length} item(s)\n` +
      `The user must approve this spec (via spec_review) before edit_file/write_file will proceed in --spec-mode.`,
  };
}
