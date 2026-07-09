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
}

/**
 *
 */
export const DEFAULT_BLAST_RADIUS_CONFIG: BlastRadiusConfig = {
  maxDeletionRatio: 0.20,
  minLinesToEnforce: 10,
  maxAbsoluteDeletion: 500,
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
  /** Number of lines in the original file. */
  totalLines: number;
  /** Why the edit was blocked (if `allowed` is false). */
  reason?: string;
}

/**
 * Compute the blast radius of a file edit.
 *
 * Uses a simple line-by-line diff (not a full LCS) for speed. This is
 * conservative — it may over-count deletions when lines are reordered,
 * which is the safe direction.
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

  // Don't enforce on tiny files
  if (totalLines < config.minLinesToEnforce) {
    return {
      allowed: true,
      deletionRatio: 0,
      deletedLines: 0,
      totalLines,
    };
  }

  // Compute a simple diff: count lines in old that are not in new
  // (This is conservative — it over-counts deletions on reorders)
  const newSet = new Set(newLines);
  let deletedLines = 0;
  for (const line of oldLines) {
    if (!newSet.has(line)) {
      deletedLines++;
    }
  }

  const deletionRatio = totalLines > 0 ? deletedLines / totalLines : 0;

  // Check absolute deletion cap
  if (deletedLines > config.maxAbsoluteDeletion) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      totalLines,
      reason: `Blast radius exceeded: ${deletedLines} lines deleted (max ${config.maxAbsoluteDeletion})`,
    };
  }

  // Check ratio
  if (deletionRatio > config.maxDeletionRatio) {
    return {
      allowed: false,
      deletionRatio,
      deletedLines,
      totalLines,
      reason: `Blast radius exceeded: ${(deletionRatio * 100).toFixed(1)}% of file deleted (max ${(config.maxDeletionRatio * 100).toFixed(1)}%)`,
    };
  }

  return {
    allowed: true,
    deletionRatio,
    deletedLines,
    totalLines,
  };
}
