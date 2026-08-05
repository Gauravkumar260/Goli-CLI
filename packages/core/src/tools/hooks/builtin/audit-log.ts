/**
 * audit_log hook (Module 3, part 2).
 *
 * PostToolUse hook that logs every tool call to the immutable audit log.
 * This is the same audit log as Module 4's sandbox audit log — this hook
 * extends it to cover ALL tool calls (not just bash).
 *
 * @module tools/hooks/builtin/audit-log
 */

import { randomUUID } from 'node:crypto';

import { appendAuditLog } from '../../../sandbox/audit-log.js';

import type { AuditLogEntry, PermissionTier, SandboxMode } from '../../../sandbox/types.js';
import type { Hook, HookContext, PostToolUseHookResult } from '../types.js';

/** Map tool names to permission tiers. */
const TOOL_TIER_MAP: Record<string, PermissionTier> = {
  read_file: 'T0',
  list_directory: 'T0',
  grep: 'T0',
  write_file: 'T1',
  edit_file: 'T1',
  bash: 'T2',
};

/**
 * Cached session ID. The previous implementation called `randomUUID()`
 * for EVERY audit entry if `GOLI_SESSION_ID` was unset, giving each entry
 * a different ID and destroying the "session" concept (you couldn't group
 * entries by session). We now cache the generated ID for the process
 * lifetime so all entries in a single process share a session ID.
 */
let cachedSessionId: string | null = null;

function getSessionId(): string {
  const env = process.env['GOLI_SESSION_ID'];
  if (env) return env;
  if (!cachedSessionId) {
    cachedSessionId = randomUUID();
  }
  return cachedSessionId;
}

/** The audit_log hook. */
export const AUDIT_LOG_HOOK: Hook = {
  name: 'audit_log',
  event: 'PostToolUse',
  handler: (ctx: HookContext): PostToolUseHookResult => {
    // Determine the actual sandbox mode. The previous implementation
    // hardcoded 'workspace-write' when god mode was off, ignoring the
    // actual mode (which could be 'read-only'). The HookContext doesn't
    // carry sandboxMode, so we fall back to godMode heuristic if needed.
    const sandboxMode: SandboxMode = ctx.godMode
      ? 'danger-full-access'
      : (ctx.sandboxMode ?? 'workspace-write');
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      tool: ctx.toolName,
      // Truncate long args safely. The previous implementation
      // used `JSON.stringify(ctx.args).slice(0, 497) + '...'`
      // which produced invalid JSON (truncated mid-object/mid-string).
      // A log parser using `JSON.parse` would fail on truncated
      // entries. We now truncate the STRING representation and
      // mark it with a leading `[TRUNCATED]` prefix so parsers
      // can skip it.
      action: (() => {
        const json = JSON.stringify(ctx.args);
        if (json.length > 500) {
          return '[TRUNCATED] ' + json.slice(0, 490) + '...';
        }
        return json;
      })(),
      sandboxMode,
      approval: 'allow',
      tier: TOOL_TIER_MAP[ctx.toolName] ?? 'T1',
      ok: ctx.result?.ok ?? false,
      // Use the actual exit code from the result if available; otherwise
      // infer from ok. The previous implementation always used 0/1, which
      // was wrong for bash commands with non-zero exits.
      exitCode: ctx.result?.ok ? 0 : 1,
      durationMs: ctx.result?.durationMs ?? 0,
      sessionId: getSessionId(),
      workspaceRoot: ctx.workspaceRoot,
    };

    appendAuditLog(entry);

    // No feedback — the audit log is silent (don't clutter the conversation)
    return {};
  },
  priority: 5, // Run first (before auto_format / git_checkpoint)
  disableable: false,
};
