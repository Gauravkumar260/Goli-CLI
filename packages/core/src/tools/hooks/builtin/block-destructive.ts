/**
 * block_destructive hook (Module 3, part 2).
 *
 * PreToolUse hook that denies destructive commands and file operations:
 * - `rm -rf /`, `mkfs`, `dd if=/dev/zero`, fork bombs
 * - `DROP TABLE`, `DELETE FROM`, `TRUNCATE TABLE` (SQL injection)
 * - `curl|bash`, `wget|bash` (remote code execution)
 * - `> /dev/sdX` (raw disk writes)
 * - `chmod -R 777 /` (security hole)
 * - `shutdown`, `reboot`, `halt`
 *
 * This hook is NOT disableable — it's a mandatory safety hook.
 *
 * @module tools/hooks/builtin/block-destructive
 */

import type { Hook, HookContext, PreToolUseHookResult } from '../types.js';

/** Destructive command patterns (always denied). */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\//, reason: 'rm -rf / — would delete entire filesystem' },
  { pattern: /rm\s+-rf\s+\*/, reason: 'rm -rf * — would delete workspace' },
  { pattern: /mkfs/, reason: 'mkfs — would format a filesystem' },
  { pattern: /dd\s+if=\/dev\/zero/, reason: 'dd if=/dev/zero — would overwrite disk' },
  { pattern: /:\(\)\s*\{.*\};:/, reason: 'fork bomb' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'write to raw disk device' },
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, reason: 'curl | bash — remote code execution' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, reason: 'wget | bash — remote code execution' },
  { pattern: /DROP\s+TABLE/i, reason: 'SQL DROP TABLE' },
  { pattern: /DELETE\s+FROM/i, reason: 'SQL DELETE FROM' },
  { pattern: /TRUNCATE\s+TABLE/i, reason: 'SQL TRUNCATE TABLE' },
  { pattern: /chmod\s+-R\s+777\s+\//, reason: 'chmod -R 777 / — security hole' },
  { pattern: /shutdown|reboot|halt/, reason: 'system shutdown/reboot' },
];

/** The block_destructive hook. */
export const BLOCK_DESTRUCTIVE_HOOK: Hook = {
  name: 'block_destructive',
  event: 'PreToolUse',
  handler: (ctx: HookContext): PreToolUseHookResult => {
    // Only check the bash tool
    if (ctx.toolName !== 'bash') {
      return { decision: 'allow' };
    }

    const command = (ctx.args['command'] as string) ?? '';

    // God mode still blocks destructive commands (defense in depth)
    for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          decision: 'deny',
          reason: `Blocked by block_destructive: ${reason}`,
        };
      }
    }

    return { decision: 'allow' };
  },
  priority: 10, // Run first (before other safety hooks)
  disableable: false,
};
