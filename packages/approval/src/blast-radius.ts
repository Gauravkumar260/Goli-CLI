/**
 * Blast Radius Enforcer (Module 4).
 *
 * A deterministic guardrail that blocks file diffs exceeding a deletion
 * threshold (default: 20%). This prevents the agent from accidentally
 * deleting large portions of files.
 *
 * The enforcer computes the diff between the old and new content, counts
 * the number of deleted lines, and blocks if the deletion ratio exceeds
 * the threshold.
 *
 * @module approval/blast-radius
 */

/**
 *
 */
export interface BlastRadiusConfig {
  /** Max deletion ratio (0.0 – 1.0). Default: 0.20 (20%). */
  maxDeletionRatio: number;
  /** Min total lines to enforce (don't enforce on tiny files). Default: 10. */
  minLinesToEnforce: number;
  /** Max absolute lines that can be deleted in a single edit. Default: 500. */
  maxAbsoluteDeletion: number;
  /** Max absolute lines that can be ADDED in a single edit. Default: 2000. */
  maxAbsoluteAddition: number;
  /** Max ratio of added lines to original. Default: 5.0 (500%). */
  maxAdditionRatio: number;
  /** Max total lines in the NEW file. Default: 20_000. */
  maxTotalNewLines: number;
}

/**
 *
 */
export const DEFAULT_BLAST_RADIUS_CONFIG: BlastRadiusConfig = {
  maxDeletionRatio: 0.20,
  minLinesToEnforce: 10,
  maxAbsoluteDeletion: 500,
  // Additions guards — the previous implementation only counted
  // DELETED lines, so an agent could add 10,000 lines (backdoor,
  // minified payload, crypto-miner script) and `deletedLines = 0`,
  // `deletionRatio = 0%` → `allowed: true`. The guardrail is
  // supposed to prevent large destructive edits, but adding a
  // backdoor is just as destructive as deleting code.
  maxAbsoluteAddition: 2000,
  maxAdditionRatio: 5.0,
  maxTotalNewLines: 20_000,
};

/**
 *
 */
export interface BlastRadiusResult {
  /** Whether the edit is allowed. */
  allowed: boolean;
  /** The deletion ratio (0.0 – 1.0). */
  deletionRatio: number;
  /** Number of lines deleted. */
  deletedLines: number;
  /** Number of lines added. */
  addedLines: number;
  /** Number of lines in the original file. */
  totalLines: number;
  /** Number of lines in the new file. */
  totalNewLines: number;
  /** Why the edit was blocked (if `allowed` is false). */
  reason?: string;
}

/**
 * Compute the blast radius of a file edit.
 *
 * Uses a multiplicity-aware line diff: for each unique line, we
 * compare the count in the old file vs the count in the new file.
 * The MINIMUM of those counts is the "preserved" lines; the rest
 * are deleted (if old count > new count) or added (if new count >
 * old count). The previous implementation used a plain `Set` for
 * `newLines`, which under-counted deletions on files with duplicate
 * lines: e.g., old = `["a","a","b"]`, new = `["a","c"]` — the Set
 * of new was `{"a","c"}`, so both "a" lines in old were considered
 * preserved, only "b" was deleted (1 line, 33%). The actual diff
 * deletes one "a" and "b" (2 lines, 67%). The Set approach was
 * UNSAFE — it under-reported blast radius.
 *
 * We also now count ADDED lines and block on additions. The
 * previous implementation only counted deletions, so an agent
 * could add 10,000 lines (a backdoor, minified payload, etc.)
 * and `deletedLines = 0` → `allowed: true`.
 *
 * @param oldContent - The original file content.
 * @param newContent - The new file content.
 * @param config - The blast radius config.
 */
export function computeBlastRadius(
  oldContent: string,
  newContent: string,
  config: BlastRadiusConfig = DEFAULT_BLAST_RADIUS_CONFIG,
): BlastRadiusResult {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const totalLines = oldLines.length;
  const totalNewLines = newLines.length;

  // Don't enforce on tiny files
  if (totalLines < config.minLinesToEnforce) {
    return {
      allowed: true,
      deletionRatio: 0,
      deletedLines: 0,
      addedLines: 0,
      totalLines,
      totalNewLines,
    };
  }

  // Multiplicity-aware diff: count occurrences per unique line in
  // each version, then for each unique line compute the deletion /
  // addition as the difference between counts.
  const oldCounts = new Map<string, number>();
  for (const line of oldLines) {
    oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
  }
  const newCounts = new Map<string, number>();
  for (const line of newLines) {
    newCounts.set(line, (newCounts.get(line) ?? 0) + 1);
  }

  let deletedLines = 0;
  let addedLines = 0;
  // Walk old: any count in old that exceeds count in new is a deletion.
  for (const [line, oldCount] of oldCounts) {
    const newCount = newCounts.get(line) ?? 0;
    if (oldCount > newCount) {
      deletedLines += oldCount - newCount;
    }
  }
  // Walk new: any count in new that exceeds count in old is an addition.
  for (const [line, newCount] of newCounts) {
    const oldCount = oldCounts.get(line) ?? 0;
    if (newCount > oldCount) {
      addedLines += newCount - oldCount;
    }
  }

  const deletionRatio = totalLines > 0 ? deletedLines / totalLines : 0;
  const additionRatio = totalLines > 0 ? addedLines / totalLines : 0;

  // Check absolute deletion cap
  if (deletedLines > config.maxAbsoluteDeletion) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      addedLines,
      totalLines,
      totalNewLines,
      reason: `Blast radius exceeded: ${deletedLines} lines deleted (max ${config.maxAbsoluteDeletion})`,
    };
  }

  // Check ratio
  if (deletionRatio > config.maxDeletionRatio) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      addedLines,
      totalLines,
      totalNewLines,
      reason: `Blast radius exceeded: ${(deletionRatio * 100).toFixed(1)}% of file deleted (max ${(config.maxDeletionRatio * 100).toFixed(1)}%)`,
    };
  }

  // Additions guards (new — see DEFAULT_BLAST_RADIUS_CONFIG rationale).
  if (addedLines > config.maxAbsoluteAddition) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      addedLines,
      totalLines,
      totalNewLines,
      reason: `Blast radius exceeded: ${addedLines} lines added (max ${config.maxAbsoluteAddition})`,
    };
  }
  if (additionRatio > config.maxAdditionRatio) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      addedLines,
      totalLines,
      totalNewLines,
      reason: `Blast radius exceeded: ${(additionRatio * 100).toFixed(1)}% of file added (max ${(config.maxAdditionRatio * 100).toFixed(1)}%)`,
    };
  }
  if (totalNewLines > config.maxTotalNewLines) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      addedLines,
      totalLines,
      totalNewLines,
      reason: `Blast radius exceeded: new file has ${totalNewLines} lines (max ${config.maxTotalNewLines})`,
    };
  }

  return {
    allowed: true,
    deletionRatio,
    deletedLines,
    addedLines,
    totalLines,
    totalNewLines,
  };
}
