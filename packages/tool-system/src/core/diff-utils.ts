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
 * Compute a unified diff between old and new content.
 *
 * Uses a classic LCS (longest-common-subsequence) algorithm to find
 * ALL change regions (not just one). The previous implementation
 * only found common prefix + suffix + a single change region in the
 * middle — for edits like "change line 5 AND line 50", it emitted
 * one giant change covering lines 5-50, marking 44 unchanged lines
 * as removed+added. The LCS-based algorithm correctly emits two
 * separate change regions with 3 lines of context around each.
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

  // Empty content is 0 lines, not 1 empty line.
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');

  // Compute the LCS table. lcs[i][j] = length of the LCS of
  // oldLines[i..] and newLines[j..]. We build it bottom-up.
  // Memory: O(oldLines.length * newLines.length). For most diffs
  // this is fine (a few thousand cells). For pathological cases
  // (10K-line files), we fall back to prefix/suffix diff.
  const m = oldLines.length;
  const n = newLines.length;
  // 10M cells = ~80MB (Int32Array). Beyond that, fall back.
  if (m * n > 10_000_000) {
    return computeDiffPrefixSuffix(oldLines, newLines);
  }

  // Build LCS DP table. Use a flat Uint32Array for cache efficiency.
  const dp = new Uint32Array((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[idx(i, j)] = dp[idx(i + 1, j + 1)] + 1;
      } else {
        dp[idx(i, j)] = Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
      }
    }
  }

  // Walk the DP table to produce the diff. We emit:
  //   - context lines (' ') when oldLines[i] === newLines[j]
  //   - removed lines ('-') when we skip an old line
  //   - added lines ('+') when we skip a new line
  // Then post-process to insert 3 lines of context around each
  // change region (trimming context between distant change regions
  // to keep the diff readable).
  interface DiffOp { type: ' ' | '-' | '+'; line: string; oldLineNum?: number; newLineNum?: number; }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: ' ', line: oldLines[i], oldLineNum: i + 1, newLineNum: j + 1 });
      i++;
      j++;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      ops.push({ type: '-', line: oldLines[i], oldLineNum: i + 1 });
      i++;
    } else {
      ops.push({ type: '+', line: newLines[j], newLineNum: j + 1 });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: '-', line: oldLines[i], oldLineNum: i + 1 });
    i++;
  }
  while (j < n) {
    ops.push({ type: '+', line: newLines[j], newLineNum: j + 1 });
    j++;
  }

  // Post-process: keep 3 lines of context around each change region.
  // A change region is a maximal run of non-context ops. Between
  // regions, we keep the first 3 context lines + the last 3 context
  // lines (with a "[... N context lines omitted ...]" separator if
  // there are more than 6 context lines between regions).
  const CONTEXT = 3;
  const keepFlag = new Array<boolean>(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== ' ') {
      // Keep CONTEXT lines before and after this change.
      for (let c = Math.max(0, k - CONTEXT); c <= Math.min(ops.length - 1, k + CONTEXT); c++) {
        keepFlag[c] = true;
      }
    }
  }

  const lines: string[] = [];
  let inOmitted = false;
  for (let k = 0; k < ops.length; k++) {
    if (keepFlag[k]) {
      if (inOmitted) {
        // Count the omitted context lines for the separator.
        // (We don't actually count — just emit a generic marker.)
        // Only emit the marker BETWEEN two kept regions — never at
        // the start of the diff (a leading marker inflates the line
        // count and adds noise with no preceding context to omit).
        if (lines.length > 0) {
          lines.push(' [... context lines omitted ...]');
        }
        inOmitted = false;
      }
      const op = ops[k]!;
      lines.push(`${op.type}${op.line}`);
    } else if (ops[k].type === ' ') {
      // Omitted context line. Mark that we're in an omission run.
      if (!inOmitted) inOmitted = true;
    } else {
      // Should never happen — non-context ops are always kept.
      const op = ops[k]!;
      lines.push(`${op.type}${op.line}`);
    }
  }

  return lines;
}

/**
 * Fallback diff: prefix + suffix + single change region.
 *
 * Used when the LCS DP table would be too large (m*n > 10M cells).
 * This is the previous implementation's algorithm — it's correct
 * (just less readable for multi-region edits).
 */
function computeDiffPrefixSuffix(oldLines: string[], newLines: string[]): string[] {
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
