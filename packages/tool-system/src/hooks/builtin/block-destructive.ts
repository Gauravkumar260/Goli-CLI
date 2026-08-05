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

/**
 * Tools that can execute arbitrary code and therefore must be inspected
 * for destructive patterns — not just `bash`. The previous
 * implementation only checked `ctx.toolName === 'bash'`, so an LLM
 * could route destructive code through `execute_code`, dynamic tools
 * (created via `save_tool`), or `notebook_edit` (which can execute cell
 * code) and bypass the hook entirely.
 *
 * The set is matched against `ctx.toolName` with `has()`. Dynamic tool
 * names from `save_tool` always contain a hyphen by the kebab-case
 * regex enforced in dynamic-tool-manager.ts; we additionally accept
 * any name that starts with `dyn-` as a defensive prefix.
 */
const CODE_EXECUTING_TOOLS = new Set<string>([
  'bash',
  'execute_code',
  'save_tool',
  'notebook_edit',
]);

/** Destructive command patterns (always denied). */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // ─── Recursive deletes ──────────────────────────────────────
  // Use the `s` (dotAll) flag and accept quoted variants so
  // `rm -rf '/'`, `rm -rf $HOME`, `rm -rf ~`, `rm -rf $'/'`
  // are all caught. The previous implementation required a literal
  // `/` immediately after `rm -rf\s+`, so `rm -rf '/'` (with quotes)
  // and `rm -rf $HOME` (env var) bypassed it.
  { pattern: /rm\s+-rf\s+['"$]?(\s*\/|\*|~|\$HOME|\$\{HOME\})/s, reason: 'rm -rf on root/workspace/home — would delete filesystem' },
  { pattern: /rm\s+-rf\s+['"]?\.\./s, reason: 'rm -rf .. — would delete parent directory' },
  // ─── Filesystem formatting ──────────────────────────────────
  { pattern: /mkfs/, reason: 'mkfs — would format a filesystem' },
  { pattern: /dd\s+if=\/dev\/(?:zero|urandom)/s, reason: 'dd if=/dev/zero — would overwrite disk' },
  // ─── Fork bombs ─────────────────────────────────────────────
  { pattern: /:\(\)\s*\{.*\};:/s, reason: 'fork bomb' },
  // ─── Raw disk writes ────────────────────────────────────────
  { pattern: />\s*\/dev\/sd[a-z]/s, reason: 'write to raw disk device' },
  // ─── Remote code execution via pipe ─────────────────────────
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/s, reason: 'curl | bash — remote code execution' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/s, reason: 'wget | bash — remote code execution' },
  // ─── find with destructive exec/delete ─────────────────────
  // The previous implementation did not catch `find / -delete` or
  // `find / -exec rm -rf {} \;` — both are equivalent to `rm -rf /`.
  { pattern: /find\s+.*-exec\s+rm\s/s, reason: 'find -exec rm — recursive delete via find' },
  { pattern: /find\s+.*-delete\b/s, reason: 'find -delete — recursive delete via find' },
  // ─── rsync with --delete on root ────────────────────────────
  { pattern: /rsync\s+.*--delete.*\s\/\s/s, reason: 'rsync --delete on root — would delete filesystem' },
  // ─── SQL injection (anchored to word boundaries so they don't
  // match inside string literals like `grep "DROP TABLE" schema.sql`
  // or `echo "DROP TABLE users"`). The previous unanchored
  // `/DROP\s+TABLE/i` matched ANY string content.
  { pattern: /\bDROP\s+TABLE\b/i, reason: 'SQL DROP TABLE' },
  { pattern: /\bDELETE\s+FROM\b/i, reason: 'SQL DELETE FROM' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: 'SQL TRUNCATE TABLE' },
  // ─── chmod -R 777 on root ────────────────────────────────────
  { pattern: /chmod\s+-R\s+777\s+\//, reason: 'chmod -R 777 / — security hole' },
  // ─── System shutdown/reboot/halt — anchored to command starts
  // so `cat shutdown-plan.md` and `grep reboot logs.txt` are NOT
  // false-positive blocked. The previous unanchored
  // `/shutdown|reboot|halt/` matched any string content.
  { pattern: /(?:^|;|&&|\|\|)\s*(?:sudo\s+)?(?:shutdown|reboot|halt)\b/i, reason: 'system shutdown/reboot' },
  // ─── python/ruby/node -c with rm or system() ────────────────
  // The previous implementation missed `python -c "import os;
  // os.system('rm -rf /')"`. Catch common interpreter -c patterns.
  { pattern: /(?:python|python3|ruby|node|perl)\s+-[ec]\s+['"].*(?:os\.system|subprocess|exec|`|rm\s+-rf)/s, reason: 'interpreter -c with destructive system call' },
];

/** The block_destructive hook. */
export const BLOCK_DESTRUCTIVE_HOOK: Hook = {
  name: 'block_destructive',
  event: 'PreToolUse',
  handler: (ctx: HookContext): PreToolUseHookResult => {
    // Check ALL code-executing tools, not just `bash`. The previous
    // implementation returned `allow` for any tool other than `bash`,
    // so `execute_code`, dynamic tools (created via `save_tool`), and
    // `notebook_edit` could all run destructive code uninspected.
    if (!CODE_EXECUTING_TOOLS.has(ctx.toolName) && !ctx.toolName.startsWith('dyn-')) {
      return { decision: 'allow' };
    }

    const command = (ctx.args['command'] as string) ?? '';
    if (!command) {
      // For tools that don't take a `command` arg (e.g., notebook_edit
      // takes `cell_source`), check that field too.
      const cellSource = (ctx.args['cell_source'] as string) ??
        (ctx.args['code'] as string) ??
        (ctx.args['script'] as string) ?? '';
      if (!cellSource) return { decision: 'allow' };
      for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(cellSource)) {
          return {
            decision: 'deny',
            reason: `Blocked by block_destructive (in ${ctx.toolName} source): ${reason}`,
          };
        }
      }
      return { decision: 'allow' };
    }

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
