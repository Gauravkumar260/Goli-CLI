/**
 * Git worktree isolation (Module 7).
 *
 * Each parallel subagent gets its own `git worktree add` — a separate
 * working directory sharing the same .git object store. This provides
 * concurrency isolation (no file conflicts) but is NOT a security
 * boundary (must combine with Module 4 sandbox).
 *
 * ## Security
 *
 * All git invocations use `execFileSync` with arg arrays (never shell
 * strings) to prevent command injection via crafted `subagentId` or
 * `branchName` values.
 *
 * @module orchestration/worktree/isolation
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

import type { Logger } from '../../utils/logger.js';

/** A git worktree for a subagent. */
export interface Worktree {
  /** The worktree path (the working directory). */
  path: string;
  /** The branch name. */
  branch: string;
  /** The subagent ID. */
  subagentId: string;
  /** Whether the worktree was created successfully. */
  created: boolean;
}

/** Options for WorktreeIsolation. */
export interface WorktreeIsolationOptions {
  /** The workspace root (the main repo). */
  workspaceRoot: string;
  /** The directory for worktrees (default: ../agent-workspaces). */
  worktreeDir?: string;
  /** Logger instance. */
  logger?: Logger;
}

/**
 * Validate that a git ref name is safe to use as a branch.
 *
 * Git ref naming rules (git check-ref-format):
 * - Cannot start with `.` or `/`
 * - Cannot contain `..`, `~`, `^`, `:`, ` `, `\`, `?`, `*`, `[`
 * - Cannot end with `.lock`, `/`, or `.`
 * - Cannot contain `@{`
 * - Cannot be `@` alone
 *
 * We use a conservative allowlist (alphanumeric, dash, underscore, slash)
 * to keep the check simple and safe.
 * @param name
 */
function isValidRefName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.startsWith('.') || name.startsWith('/')) return false;
  // Allow alphanumeric, dash, underscore, slash, dot (not leading/trailing)
  return /^[a-zA-Z0-9][a-zA-Z0-9/_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/.test(name);
}

/**
 * Validate that a path is safe to use as a worktree directory.
 * @param p
 */
function isSafePath(p: string): boolean {
  if (!isAbsolute(p)) return false;
  // Refuse root, /etc, /usr, /var, /sys, /proc, /dev, /boot, /root, /home (parent)
  const dangerous = ['/etc', '/usr', '/var', '/sys', '/proc', '/dev', '/boot', '/root', '/bin', '/sbin', '/lib', '/lib64'];
  if (dangerous.some((d) => p === d || p.startsWith(`${d}/`))) return false;
  if (p === '/') return false;
  return true;
}

/** Worktree isolation — manages git worktrees for parallel subagents. */
export class WorktreeIsolation {
  private readonly workspaceRoot: string;
  private readonly worktreeDir: string;
  private readonly log?: Logger;
  private readonly worktrees: Map<string, Worktree> = new Map();

  constructor(opts: WorktreeIsolationOptions) {
    this.workspaceRoot = opts.workspaceRoot;
    this.worktreeDir = opts.worktreeDir ?? resolve(opts.workspaceRoot, '..', 'agent-workspaces');
    this.log = opts.logger;
  }

  /**
   * Create a worktree for a subagent.
   *
   * @param subagentId - The subagent ID (must be a safe ref-name component).
   * @param branchName - The branch name (default: `agent-task-{subagentId-prefix}`).
   * @returns The worktree.
   */
  create(subagentId: string, branchName?: string): Worktree {
    // Sanitize subagentId: keep only alphanumeric/dash chars, max 8 chars.
    // This is used in branch names and directory paths — must be a safe
    // ref-name component.
    const safeId = subagentId.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 8);
    if (!safeId) {
      this.log?.error('Invalid subagentId (empty after sanitization)', { subagentId });
      return { path: '', branch: '', subagentId, created: false };
    }
    const branch = branchName ?? `agent-task-${safeId}`;
    if (!isValidRefName(branch)) {
      this.log?.error('Invalid branch name (rejected by ref-name validator)', { branch });
      return { path: '', branch, subagentId, created: false };
    }
    const path = join(this.worktreeDir, safeId);
    if (!isSafePath(path)) {
      this.log?.error('Worktree path rejected by safety check', { path });
      return { path, branch, subagentId, created: false };
    }

    try {
      // Ensure the worktree directory exists
      mkdirSync(this.worktreeDir, { recursive: true });

      // Create the worktree + branch. Use execFileSync with arg array
      // (never a shell string) to prevent command injection.
      execFileSync('git', ['worktree', 'add', '-b', branch, path], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      const worktree: Worktree = { path, branch, subagentId, created: true };
      this.worktrees.set(subagentId, worktree);

      this.log?.info('Worktree created', { subagentId, branch, path });
      return worktree;
    } catch (err) {
      this.log?.error('Failed to create worktree', {
        subagentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { path, branch, subagentId, created: false };
    }
  }

  /**
   * Remove a worktree (cleanup after subagent completes).
   *
   * Note: `--force` discards uncommitted changes in the worktree. If a
   * subagent's work wasn't committed, it's lost. Callers should `merge()`
   * before `remove()` to preserve work.
   * @param subagentId
   */
  remove(subagentId: string): boolean {
    const worktree = this.worktrees.get(subagentId);
    if (!worktree) return false;

    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree.path], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      });
      this.worktrees.delete(subagentId);
      this.log?.info('Worktree removed', { subagentId, path: worktree.path });
      return true;
    } catch {
      // Force remove the directory if git worktree remove fails.
      // Re-validate the path before rmSync to defend against any drift.
      if (isSafePath(worktree.path) && existsSync(worktree.path)) {
        try {
          rmSync(worktree.path, { recursive: true, force: true });
        } catch {
          // Best-effort
        }
      }
      this.worktrees.delete(subagentId);
      return false;
    }
  }

  /**
   * Merge a worktree's branch back into a target branch.
   *
   * IMPORTANT: The previous implementation accepted `targetBranch` but
   * never used it — the merge happened on whatever branch was checked
   * out in `workspaceRoot`. We now explicitly check out `targetBranch`
   * before merging so the merge lands on the intended branch.
   *
   * @param subagentId - The subagent whose branch should be merged.
   * @param targetBranch - The branch to merge INTO (default: 'main').
   * @returns True if the merge succeeded.
   */
  merge(subagentId: string, targetBranch: string = 'main'): boolean {
    const worktree = this.worktrees.get(subagentId);
    if (!worktree || !worktree.created) return false;
    if (!isValidRefName(targetBranch)) {
      this.log?.error('Invalid target branch name', { targetBranch });
      return false;
    }

    // Remember the branch the user had checked out BEFORE we did
    // `git checkout targetBranch` so we can restore it on merge
    // failure (or success — don't surprise the user by switching
    // their working branch).
    let originalBranch: string | undefined;
    try {
      originalBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Detached HEAD or other — leave originalBranch undefined.
    }

    let mergeSucceeded = false;
    try {
      // Check out the target branch in the main workspace so the merge
      // lands on the intended branch (not whatever was checked out before).
      execFileSync('git', ['checkout', targetBranch], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      });

      // Merge the subagent's branch. Pass the merge message via -m arg.
      const mergeMessage = `Merge agent task: ${subagentId}`;
      execFileSync('git', ['merge', '--no-ff', worktree.branch, '-m', mergeMessage], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      });
      mergeSucceeded = true;

      // Delete the merged branch.
      execFileSync('git', ['branch', '-d', worktree.branch], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      });

      this.log?.info('Worktree merged', { subagentId, branch: worktree.branch, target: targetBranch });
    } catch (err) {
      this.log?.error('Worktree merge failed — preserving branch + worktree for manual recovery', {
        subagentId,
        branch: worktree.branch,
        target: targetBranch,
        error: err instanceof Error ? err.message : String(err),
      });
      // If the merge started but conflicted, abort it so the user's
      // working tree is not left in a conflicted state.
      if (mergeSucceeded === false) {
        try {
          execFileSync('git', ['merge', '--abort'], {
            cwd: this.workspaceRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5_000,
          });
        } catch {
          // No merge in progress — ignore.
        }
      }
      // DO NOT delete the branch — the conflicting work is still
      // in `worktree.branch` and may be recoverable. The caller
      // (swarm-pipeline.ts) sees the `false` return and preserves
      // the worktree (we already updated the call site in the
      // CRITICAL pass).
    } finally {
      // Restore the original branch so we don't surprise the user
      // by switching their working branch (we did `git checkout
      // targetBranch` above).
      if (originalBranch && originalBranch !== 'HEAD' && originalBranch !== targetBranch) {
        try {
          execFileSync('git', ['checkout', originalBranch], {
            cwd: this.workspaceRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5_000,
          });
        } catch {
          // Best-effort.
        }
      }
    }
    return mergeSucceeded;
  }

  /** Get all active worktrees. */
  getActive(): Worktree[] {
    return [...this.worktrees.values()];
  }

  /** Clean up all worktrees. */
  cleanup(): void {
    for (const subagentId of [...this.worktrees.keys()]) {
      this.remove(subagentId);
    }
  }
}
