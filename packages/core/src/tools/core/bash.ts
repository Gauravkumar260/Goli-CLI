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
import { executeInSandbox } from '../../sandbox/executor.js';
import { isSymlinkCreationCommand } from '../../sandbox/path-validation.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const BASH_TOOL: Tool = {
  name: 'bash',
  description:
    'Execute a shell command in the OS-native sandbox. Commands are classified into ' +
    'tiers (T0 Safe, T1-T2 Risky, T3 Destructive) and may require approval based on ' +
    'the sandbox mode. Dangerous commands (rm -rf /, mkfs, etc.) are always blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds. Default: 30.',
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
  const timeout = ((args['timeout'] as number | undefined) ?? 30);

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

  // ─── Execute in the sandbox ──────────────────────────────────
  const result = executeInSandbox(command, {
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
