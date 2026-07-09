/**
 * Shared diff-approval helper for the file-mutating core tools.
 *
 * Extracted during dedup loop iteration 2 from previously-duplicated logic in
 * `edit-file.ts` and `write-file.ts`. Both tools had a verbatim copy of the
 * "request approval for a single diff entry → translate the user's response
 * into either proceed or a pre-built rejection ToolResult" block, differing
 * only in the operation label ("edit" vs "write") embedded in one error
 * message. This module factors that block into one parameterized helper.
 *
 * Behavior is identical to both originals:
 *   - Calls `ctx.requestDiffApproval([entry])`.
 *   - If the user pressed `R` (reject-all), returns a rejection with the
 *     "Diff review disabled for this session." message.
 *   - If the user rejected this specific entry, returns a rejection with the
 *     "User rejected the proposed <op> to <path>." message.
 *   - Otherwise returns `{ accepted: true }` and the caller proceeds.
 *
 * The caller still owns the outer guards (`ctx.requestDiffApproval` exists,
 * `ctx.diffReviewDisabled` is false, and — for write_file only — the diff is
 * non-empty). Those guards differ between tools and are intentionally NOT
 * folded into this helper.
 *
 * @module tools/core/diff-approval
 */

import type { DiffEntry } from './diff-utils.js';
import type { ToolContext, ToolResult } from '../types.js';

/**
 * Outcome of a single-entry diff-approval check.
 *
 * - `{ accepted: true }` — caller may proceed with the file mutation.
 * - `{ accepted: false, rejection }` — caller should `return rejection;`
 *   immediately, skipping the mutation.
 */
export type SingleEntryApprovalResult =
  | { accepted: true }
  | { accepted: false; rejection: ToolResult };

/**
 * Request diff approval for a single entry and translate the user's
 * response into either "proceed" or a pre-built rejection `ToolResult`.
 *
 * @param ctx - The tool execution context (must already have been checked
 *   for `requestDiffApproval` presence and `diffReviewDisabled === false`).
 * @param entry - The diff entry to surface for approval.
 * @param operationLabel - Human-readable verb for the rejection message
 *   (e.g. `"edit"`, `"write"`).
 * @param filePath - Path included in the rejection message.
 * @returns The approval outcome. Callers should check `accepted` and
 *   short-circuit with `rejection` when `false`.
 */
export async function checkSingleEntryDiffApproval(
  ctx: ToolContext,
  entry: DiffEntry,
  operationLabel: string,
  filePath: string,
): Promise<SingleEntryApprovalResult> {
  const approval = await ctx.requestDiffApproval!([entry]);
  const myIndex = 0; // we sent a single-entry array
  const accepted = approval.accepted.includes(myIndex) || approval.acceptAll === true;
  const rejected = approval.rejected.includes(myIndex) || approval.rejectAll === true;

  if (approval.rejectAll) {
    // User pressed `R` — disable diff review for the rest of the session.
    // The caller (AgentLoop) is responsible for honoring this flag on
    // subsequent tool calls; we just return the rejection here.
    return {
      accepted: false,
      rejection: {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: 'User rejected all diffs (pressed R). Diff review disabled for this session.',
      },
    };
  }

  if (!accepted || rejected) {
    return {
      accepted: false,
      rejection: {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `User rejected the proposed ${operationLabel} to ${filePath}.`,
      },
    };
  }

  return { accepted: true };
}
