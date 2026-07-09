/**
 * Diff utilities for diff-first editing (H14).
 *
 * Provides a shared `computeDiff()` function (ported from the TUI's
 * `DiffReviewDialog.tsx`) and the `DiffEntry` / `DiffApprovalResult`
 * types used by the `ToolContext.requestDiffApproval` callback.
 *
 * ## Why diff-first?
 *
 * ADR-0037. The previous flow applied edits immediately and offered
 * `DiffReviewDialog` after the fact (with rollback via `git_checkpoint`).
 * This is inverted from industry best practice (Claude Code, Cursor,
 * Aider all show diffs BEFORE writing). Diff-first:
 *
 * - Prevents unwanted edits from touching the working tree
 * - Enables per-hunk accept/reject
 * - Makes the approval flow auditable (the diff is the artifact)
 *
 * ## Why a callback (not a registry hook)?
 *
 * The approval flow needs to round-trip through the TUI (Ink/React),
 * which the core `ToolRegistry` cannot depend on. By injecting a
 * `requestDiffApproval` callback into `ToolContext`, the registry
 * stays UI-agnostic and the TUI (or headless auto-accepter) provides
 * the implementation.
 *
 * @module tools/core/diff-utils
 */

/**
 * A single diff entry for review.
 *
 * One entry per file the tool proposes to modify. If a tool proposes
 * multiple files (e.g., a future `edit_batch` tool), it sends multiple
 * entries and the user can accept/reject each independently.
 */
export interface DiffEntry {
  /** The absolute or workspace-relative file path. */
  filePath: string;
  /** The tool that produced the diff (edit_file / write_file / edit_batch). */
  tool: string;
  /** The old content (empty string for new files via write_file). */
  oldContent: string;
  /** The proposed new content. */
  newContent: string;
  /** The diff lines (unified diff format, pre-computed via `computeDiff`). */
  diffLines: string[];
}

/**
 * Result of a diff approval request.
 *
 * - `accepted`: indices (into the entries array) the user accepted.
 * - `rejected`: indices the user rejected.
 * - `acceptAll`: if true, the caller should auto-accept all future
 *   diffs in this session (the user pressed `A`).
 * - `rejectAll`: if true, the caller should auto-reject all future
 *   diffs in this session (the user pressed `R` or Esc).
 */
export interface DiffApprovalResult {
  accepted: number[];
  rejected: number[];
  acceptAll?: boolean;
  rejectAll?: boolean;
}

/**
 * Compute a simple unified diff between old and new content.
 *
 * Line-level diff (not character-level). For most code edits, line-level
 * is sufficient and much faster than a proper LCS diff. Finds common
 * prefix + suffix, then emits 3 lines of context before/after the
 * changed region.
 *
 * Output format: each line is prefixed with `' '` (context),
 * `'-'` (removed), or `'+'` (added).
 *
 * @param oldContent - The current file content (empty string for new files).
 * @param newContent - The proposed file content.
 * @returns Array of diff lines with prefix markers.
 */
export function computeDiff(oldContent: string, newContent: string): string[] {
  // Optimization: identical content → no diff.
  if (oldContent === newContent) return [];

  // Empty content is 0 lines, not 1 empty line. Without this, diffing
  // '' against 'hello\nworld' would emit a phantom '-' line for the
  // empty old content. See tests/unit/diff-first-editing.test.ts
  // "handles empty old content (new file)".
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');
  const lines: string[] = [];

  // Find common prefix.
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix).
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Context lines (before the change) — up to 3 lines.
  const contextStart = Math.max(0, prefixLen - 3);
  for (let i = contextStart; i < prefixLen; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  // Removed lines.
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    lines.push(`-${oldLines[i]}`);
  }

  // Added lines.
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    lines.push(`+${newLines[i]}`);
  }

  // Context lines (after the change) — up to 3 lines.
  const suffixStart = oldLines.length - suffixLen;
  const contextEnd = Math.min(oldLines.length, suffixStart + 3);
  for (let i = suffixStart; i < contextEnd; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  return lines;
}

/**
 * Build a `DiffEntry` from old + new content.
 *
 * Convenience helper for tools that want to compute the diff in one shot
 * rather than calling `computeDiff` separately.
 *
 * @param filePath - The file path.
 * @param tool - The tool name.
 * @param oldContent - The current content (empty for new files).
 * @param newContent - The proposed content.
 */
export function buildDiffEntry(
  filePath: string,
  tool: string,
  oldContent: string,
  newContent: string,
): DiffEntry {
  return {
    filePath,
    tool,
    oldContent,
    newContent,
    diffLines: computeDiff(oldContent, newContent),
  };
}

/**
 * Format a diff entry as a unified-diff-style string (for logging / headless output).
 *
 * @param entry - The diff entry.
 * @returns A string like `--- a/path\n+++ b/path\n@@ ...@@\n line\n-old\n+new\n line`.
 */
export function formatDiffAsString(entry: DiffEntry): string {
  if (entry.diffLines.length === 0) {
    return `no changes to ${entry.filePath}`;
  }
  const header = `--- ${entry.filePath}\n+++ ${entry.filePath}`;
  const body = entry.diffLines.join('\n');
  return `${header}\n${body}`;
}
