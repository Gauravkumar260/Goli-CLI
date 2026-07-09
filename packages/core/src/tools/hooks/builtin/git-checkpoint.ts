/**
 * git_checkpoint hook (Module 3, part 2).
 *
 * PostToolUse hook that creates a git checkpoint (stash or commit) after
 * every successful file change. This lets the agent (and user) roll back
 * to a known-good state if something goes wrong.
 *
 * The checkpoint is created via `git stash create` + `git stash store`
 * (non-destructive — doesn't modify the working tree or HEAD). The
 * `git stash store` step persists the ref so it survives `git gc`; the
 * previous implementation only called `git stash create`, which produces
 * a dangling commit ref that GC would eventually delete.
 *
 * @module tools/hooks/builtin/git-checkpoint
 */

import { execFileSync } from 'node:child_process';

import type { Hook, HookContext, PostToolUseHookResult } from '../types.js';

/** The git_checkpoint hook. */
export const GIT_CHECKPOINT_HOOK: Hook = {
  name: 'git_checkpoint',
  event: 'PostToolUse',
  toolMatch: ['write_file', 'edit_file', 'bash'],
  handler: (ctx: HookContext): PostToolUseHookResult => {
    // Only checkpoint if the tool succeeded
    if (!ctx.result?.ok) {
      return {};
    }

    // Check if we're in a git repo. Use `git rev-parse --git-dir` instead
    // of checking for `.git` directory — in git worktrees, `.git` is a
    // FILE (gitlink), not a directory, so `existsSync` returns true but
    // the check is misleading. `rev-parse` handles both cases and also
    // walks up to parent directories (so a workspace that's a subdirectory
    // of a git repo is detected correctly).
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd: ctx.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 2000,
      });
    } catch {
      return {}; // Not a git repo — skip
    }

    // For bash, only checkpoint if the command modified files.
    // Use execFileSync with arg arrays (no shell) — the previous
    // implementation used `execSync` with shell-interpolated commands.
    if (ctx.toolName === 'bash') {
      const command = (ctx.args['command'] as string) ?? '';
      // Only checkpoint for commands that might modify files.
      // Patterns are no longer anchored with `^` so compound commands
      // (`cd /tmp && rm foo`, `git pull && npm install`) are detected.
      const modifyingPatterns = [
        /(?:^|\s|&&|;|\|\|)\s*rm\s/,
        /(?:^|\s|&&|;|\|\|)\s*mv\s/,
        /(?:^|\s|&&|;|\|\|)\s*mkdir\s/,
        /(?:^|\s|&&|;|\|\|)\s*tee\s/,
        /(?:^|\s|&&|;|\|\|)\s*>/,  // redirect to file
        /(?:^|\s|&&|;|\|\|)\s*sed\s.*-i/,
        /(?:^|\s|&&|;|\|\|)\s*npm\s+install/,
        /(?:^|\s|&&|;|\|\|)\s*pip\s+install/,
        /(?:^|\s|&&|;|\|\|)\s*git\s+checkout/,
        /(?:^|\s|&&|;|\|\|)\s*git\s+pull/,
        /(?:^|\s|&&|;|\|\|)\s*git\s+reset/,
      ];
      if (!modifyingPatterns.some((p) => p.test(command))) {
        return {}; // Not a modifying command — skip
      }
    }

    // Create a git stash checkpoint (non-destructive).
    // `git stash create` returns a dangling commit ref. We MUST call
    // `git stash store` to persist it, otherwise `git gc --prune=now`
    // will delete it (the ref is unreachable). The previous
    // implementation only called `create`, so checkpoints were lost.
    try {
      const ref = execFileSync('git', ['stash', 'create'], {
        cwd: ctx.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();

      if (ref) {
        // Persist the stash ref so it survives GC.
        const message = `goli-cli checkpoint: ${new Date().toISOString()}`;
        try {
          execFileSync('git', ['stash', 'store', '-m', message, ref], {
            cwd: ctx.workspaceRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 2000,
          });
        } catch {
          // `stash store` may fail if the ref already exists. Non-fatal —
          // the ref is still reachable via `git reflog` for a while.
        }
        return {
          feedback: `Git checkpoint created: ${ref.slice(0, 12)} (restore with: git stash apply ${ref})`,
        };
      }
      // No changes to stash (clean working tree)
      return {};
    } catch {
      // Git command failed — non-fatal
      return {};
    }
  },
  priority: 60,
  disableable: true,
};
