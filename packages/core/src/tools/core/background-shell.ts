/**
 * Background shell management tools (Module 3, competitive gap #3).
 *
 * Claude Code's Bash tool supports `run_in_background: true`, with
 * BashOutput/KillShell to poll and terminate long-running processes.
 * This lets the agent start a dev server, continue working, and check
 * back on its output later.
 *
 * Goli's `bash.ts` is synchronous only. These two tools add background
 * shell management:
 *   - `bash_output`: read stdout/stderr from a background shell.
 *   - `kill_shell`: terminate a background shell.
 *
 * The `bash` tool itself gets a new `run_in_background` option that
 * spawns the command as a child process and returns a shell ID.
 *
 * Permission tier: T2 (command execution).
 *
 * @module tools/core/background-shell
 */

import { spawn, type ChildProcess } from 'node:child_process';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/** Active background shells, keyed by shell ID. */
interface BackgroundShell {
  /** Unique shell ID. */
  id: string;
  /** The command being run. */
  command: string;
  /** The child process. */
  process: ChildProcess;
  /** Accumulated stdout. */
  stdout: string;
  /** Accumulated stderr. */
  stderr: string;
  /** Whether the process has exited. */
  exited: boolean;
  /** Exit code (if exited). */
  exitCode: number | null;
  /** When the shell was started. */
  startedAt: number;
}

/** Global registry of background shells. */
const shells = new Map<string, BackgroundShell>();

/** Counter for generating unique shell IDs. */
let shellCounter = 0;

/**
 * Start a background shell.
 *
 * Called by the `bash` tool when `run_in_background: true`.
 *
 * @param command - The command to run.
 * @param cwd - The working directory.
 * @returns The shell ID.
 */
export function startBackgroundShell(command: string, cwd: string): string {
  const id = `shell-${++shellCounter}`;
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  const shell: BackgroundShell = {
    id,
    command,
    process: child,
    stdout: '',
    stderr: '',
    exited: false,
    exitCode: null,
    startedAt: Date.now(),
  };

  child.stdout?.on('data', (data: Buffer) => {
    shell.stdout += data.toString('utf-8');
    // Cap accumulated output at 100KB to prevent memory issues.
    if (shell.stdout.length > 100_000) {
      shell.stdout = shell.stdout.slice(-100_000);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    shell.stderr += data.toString('utf-8');
    if (shell.stderr.length > 100_000) {
      shell.stderr = shell.stderr.slice(-100_000);
    }
  });

  child.on('exit', (code) => {
    shell.exited = true;
    shell.exitCode = code;
  });

  child.on('error', (err) => {
    shell.exited = true;
    shell.exitCode = -1;
    shell.stderr += `\n[error: ${err.message}]`;
  });

  shells.set(id, shell);
  return id;
}

/**
 * Check if a shell ID exists.
 * @param id
 */
export function hasShell(id: string): boolean {
  return shells.has(id);
}

// ─── bash_output tool ─────────────────────────────────────────────

/**
 *
 */
export const BASH_OUTPUT_TOOL: Tool = {
  name: 'bash_output',
  description:
    'Read the output of a background shell started with `bash` (run_in_background: true). ' +
    'Returns stdout, stderr, and the shell status (running/exited). ' +
    'Use this to check on dev servers, long builds, or test suites.',
  inputSchema: {
    type: 'object',
    properties: {
      shell_id: {
        type: 'string',
        description: 'The shell ID returned by `bash` when run_in_background was true.',
      },
    },
    required: ['shell_id'],
    additionalProperties: false,
  },
  handler: bashOutputHandler,
  tier: 'T0',
  readOnly: true,
};

async function bashOutputHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const shellId = args['shell_id'] as string;
  if (!shellId) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'bash_output requires a "shell_id" string.',
    };
  }

  const shell = shells.get(shellId);
  if (!shell) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `No background shell with ID "${shellId}". Active shells: ${[...shells.keys()].join(', ') || '(none)'}`,
    };
  }

  const status = shell.exited
    ? `exited (code ${shell.exitCode})`
    : 'running';

  const elapsedSec = Math.floor((Date.now() - shell.startedAt) / 1000);
  const lines: string[] = [
    `Shell ${shellId}: ${status} (${elapsedSec}s elapsed)`,
    `Command: ${shell.command}`,
    '',
  ];

  if (shell.stdout) {
    // Return the last 2000 chars of stdout (most recent output).
    const recent = shell.stdout.length > 2000
      ? '...\n' + shell.stdout.slice(-2000)
      : shell.stdout;
    lines.push('stdout:', recent);
  } else {
    lines.push('stdout: (empty)');
  }

  if (shell.stderr) {
    lines.push('', 'stderr:', shell.stderr.slice(-1000));
  }

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: lines.join('\n'),
  };
}

// ─── kill_shell tool ──────────────────────────────────────────────

/**
 *
 */
export const KILL_SHELL_TOOL: Tool = {
  name: 'kill_shell',
  description:
    'Terminate a background shell started with `bash` (run_in_background: true). ' +
    'Use this to stop dev servers, cancel long builds, or clean up after tests.',
  inputSchema: {
    type: 'object',
    properties: {
      shell_id: {
        type: 'string',
        description: 'The shell ID to terminate.',
      },
    },
    required: ['shell_id'],
    additionalProperties: false,
  },
  handler: killShellHandler,
  tier: 'T1',
  readOnly: false,
};

async function killShellHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const shellId = args['shell_id'] as string;
  if (!shellId) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'kill_shell requires a "shell_id" string.',
    };
  }

  const shell = shells.get(shellId);
  if (!shell) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `No background shell with ID "${shellId}".`,
    };
  }

  if (shell.exited) {
    shells.delete(shellId);
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Shell ${shellId} already exited (code ${shell.exitCode}). Cleaned up.`,
    };
  }

  try {
    shell.process.kill('SIGTERM');
    // Give it 3 seconds to exit gracefully.
    setTimeout(() => {
      if (!shell.exited) {
        shell.process.kill('SIGKILL');
      }
    }, 3000);
    shells.delete(shellId);
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Shell ${shellId} terminated (SIGTERM sent).`,
    };
  } catch {
    // Force kill if SIGTERM fails.
    try { shell.process.kill('SIGKILL'); } catch { /* best-effort */ }
    shells.delete(shellId);
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Shell ${shellId} force-killed (SIGKILL).`,
    };
  }
}

/** Clean up all background shells (for testing / session end). */
export function cleanupAllShells(): void {
  for (const [, shell] of shells) {
    if (!shell.exited) {
      try { shell.process.kill('SIGKILL'); } catch { /* best-effort */ }
    }
  }
  shells.clear();
}

/** Get all active shell IDs (for debugging). */
export function getActiveShells(): string[] {
  return [...shells.keys()];
}
