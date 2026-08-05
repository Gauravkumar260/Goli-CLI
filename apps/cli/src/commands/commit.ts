/**
 * `goli commit` — Apply pending changes from a session to your host.
 *
 * When the agent runs in sandbox mode, changes are made in an isolated
 * working directory (or Docker container). This command applies those
 * changes to the host repository.
 *
 * Flow:
 * 1. Find the most recent session's pending changes
 * 2. Show a diff preview
 * 3. Ask for confirmation (unless --auto)
 * 4. Apply the changes via `git apply` or `git checkout`
 *
 * Phase 2 status: stub. Sandbox session management lands in Phase 5.
 *
 * @module commands/commit
 */

import { loadConfig, configureLogger, defaultLifecycleLogPath } from '@goli/core';

/**
 *
 */
export async function runCommit(): Promise<number> {
  const config = loadConfig();
  configureLogger({
    level: 'silent',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });

  process.stdout.write('\n');
  process.stdout.write('📝 GOLI-CLI Commit — Apply Session Changes\n');
  process.stdout.write('═'.repeat(60) + '\n\n');
  process.stdout.write('  Sandbox mode: ' + config.sandbox.mode + '\n\n');
  process.stdout.write('  ⏳ Session change application lands in Phase 5 (Sandboxing).\n');
  process.stdout.write('  In Phase 2, the agent runs directly against your workspace.\n');
  process.stdout.write('  Use `git add` and `git commit` to persist changes manually.\n\n');

  return 0;
}
