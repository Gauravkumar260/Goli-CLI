/**
 * bash tool (Module 3, part 1 + Module 4 sandbox).
 *
 * Executes shell commands in the OS-native sandbox. Phase 5 adds:
 * - Seatbelt (macOS) / bubblewrap (Linux) sandbox execution
 * - 3-tier approval policy (Safe / Risky / Destructive)
 * - Network egress filter
 * - cgroups v2 resource limits
 * - Audit logging
 *
 * Permission tier: T2 (shell commands).
 *
 * @module tools/core/bash
 */

import { ApprovalEngine } from '../../approval/engine.js';
import { executeInSandboxAsync } from '../../sandbox/executor.js';
import { isSymlinkCreationCommand } from '../../sandbox/path-validation.js';

import { startBackgroundShell } from './background-shell.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const BASH_TOOL: Tool = {
  name: 'bash',
  description:
    'Execute a shell command in the OS-native sandbox. Commands are classified into ' +
    'tiers (T0 Safe, T1-T2 Risky, T3 Destructive) and may require approval based on ' +
    'the sandbox mode. Dangerous commands (rm -rf /, mkfs, etc.) are always blocked. ' +
    'Set run_in_background: true to spawn a long-running process (dev server, build) ' +
    'and return a shell_id that can be polled with `bash_output` and killed with ' +
    '`kill_shell`.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds. Default: 30. Must be between 1 and 3600.',
      },
      run_in_background: {
        type: 'boolean',
        description:
          'If true, spawn the command as a background process and return a shell_id. ' +
          'Use `bash_output` to read its stdout/stderr and `kill_shell` to terminate it. ' +
          'Background shells bypass the timeout and run until killed or until they exit ' +
          'naturally. The approval engine still classifies the command before spawning.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  handler: bashHandler,
  tier: 'T2',
  readOnly: false,
};

async function bashHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const command = args['command'] as string;
  const runInBackground = Boolean(args['run_in_background']);
  const rawTimeout = args['timeout'];
  // Validate timeout. The previous implementation accepted any number
  // (including NaN, Infinity, negative, and absurdly large values
  // like 1e10). We clamp to a sane range: 1s minimum, 1h maximum.
  // Negative, NaN, Infinity, and non-numeric values fall back to 30s.
  let timeout = 30;
  if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)) {
    timeout = Math.min(3600, Math.max(1, Math.floor(rawTimeout)));
  }

  // ─── Block symlink creation (sandbox escape vector) ──────────
  if (!ctx.godMode && isSymlinkCreationCommand(command)) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'Symlink creation (ln -s) is blocked inside the sandbox. Symlinks are a known sandbox-escape vector.',
    };
  }

  // ─── Read-only sandbox: block all bash ───────────────────────
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'Cannot execute commands in read-only sandbox mode. Switch to workspace-write or danger-full-access.',
    };
  }

  // ─── Classify the command via the approval engine ────────────
  const engine = new ApprovalEngine({
    sandboxMode: ctx.sandboxMode,
    approvalPolicy: 'on-request', // TODO: make configurable
    godMode: ctx.godMode,
    autoMode: ctx.autoMode,
  });

  const classification = engine.classifyCommand(command);

  // Always-blocked commands (denylist)
  if (classification.blocked) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Command blocked: ${classification.blockReason}`,
      tier: classification.tier,
    };
  }

  const decision = engine.decide(classification);

  if (decision === 'deny') {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Command denied by approval policy (tier ${classification.tier}, sandbox mode ${ctx.sandboxMode}). ${classification.description}.`,
      tier: classification.tier,
    };
  }

  // P1-3 fix (audit Finding CC-2 / 3.18): PRE-EXECUTION approval gate.
  //
  // The previous implementation treated `decide() === 'ask'` the same
  // as `'allow'` — it proceeded to execute the command and only
  // emitted a `tool` event to the TUI AFTER execution had already
  // started. By the time the TUI's `PermissionDialog` rendered, the
  // bash command had already run. This made the entire approval
  // engine decorative in `build` mode — every T1/T2/T3 command
  // (including `bash rm -rf node_modules`) executed without consent.
  //
  // We now block on `ctx.requestApproval` BEFORE calling
  // `executeInSandboxAsync`. The callback routes through
  // `CliAgentLoop.requestApproval` → `AppStateStore.waitForApproval`
  // → the TUI's `PermissionDialog`. The Promise resolves when the
  // user picks `[y]es` / `[a]lways` / `[n]o`.
  //
  // Fail-closed: when `ctx.requestApproval` is undefined (headless
  // mode without an interactive approver), `'ask'` is treated as
  // `'deny'` — the command does NOT execute. This is the safe
  // default; the user can override with `--auto` (autoMode, which
  // makes `decide()` return `'allow'` for T1/T2) or `--god`
  // (godMode, which bypasses the engine entirely).
  if (decision === 'ask') {
    if (!ctx.requestApproval) {
      // Headless / no approver wired — fail closed.
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error:
          `Command requires approval (tier ${classification.tier}) but no interactive approver is available. ` +
          `Run in TUI mode, or use --auto / --god to bypass. ` +
          `Command: ${command.slice(0, 200)}`,
        tier: classification.tier,
      };
    }
    const approvalDecision = await ctx.requestApproval({
      toolCallId: ctx.toolCallId,
      toolName: 'bash',
      tier: classification.tier,
      description: classification.description,
      args: { command, timeout, run_in_background: runInBackground },
      timestamp: new Date().toISOString(),
    });
    if (!approvalDecision.approved) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error:
          `Command denied by user${approvalDecision.reason ? `: ${approvalDecision.reason}` : ''}. ` +
          `Command: ${command.slice(0, 200)}`,
        tier: classification.tier,
      };
    }
    // Approved — fall through to execution. The `always` flag is
    // handled by the TUI's session allowlist (AppStateStore resolves
    // it via `resolveApproval` → `addToAllowlist`); we don't need to
    // do anything special here.
  }

  // ─── Background mode: spawn and return shell_id ──────────────
  // The previous implementation defined `startBackgroundShell` but
  // never called it — `bash_output`/`kill_shell` always returned
  // "no shell" because no shell was ever started. We now wire
  // `run_in_background: true` through to `startBackgroundShell`.
  if (runInBackground) {
    const shellId = startBackgroundShell(command, ctx.workspaceRoot);
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content:
        `Background shell started.\n` +
        `  shell_id: ${shellId}\n` +
        `  command:  ${command}\n` +
        `  cwd:      ${ctx.workspaceRoot}\n\n` +
        `Use \`bash_output\` with shell_id="${shellId}" to read output.\n` +
        `Use \`kill_shell\` with shell_id="${shellId}" to terminate.`,
      tier: classification.tier,
    };
  }

  // ─── Execute in the sandbox (async to avoid blocking event loop) ─
  // The previous implementation used the synchronous `executeInSandbox`,
  // which calls `execSync` and blocks the Node.js event loop for the
  // full duration of the command. A 30-second `npm install` would
  // freeze the TUI, background shells, and streaming tool results.
  // We now use the async variant which spawns the child process and
  // returns control to the event loop while it runs.
  const result = await executeInSandboxAsync(command, {
    mode: ctx.godMode ? 'danger-full-access' : ctx.sandboxMode,
    workspaceRoot: ctx.workspaceRoot,
    godMode: ctx.godMode,
    resourceLimits: {
      memoryMaxMb: 4096,
      memoryHighMb: 3072,
      cpuQuotaPercent: 200,
      pidMax: 512,
      diskMaxMb: 10240,
      wallclockTimeoutS: timeout,
    },
  });

  if (result.ok) {
    const output = result.stdout.length > 0 ? result.stdout : '(no output)';
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `$ ${command}\n${output}`,
      tier: classification.tier,
    };
  } else {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: result.stdout ? `$ ${command}\n${result.stdout}` : '',
      error: `Command failed (exit ${result.exitCode}): ${result.stderr || '(no stderr)'}`,
      tier: classification.tier,
    };
  }
}
