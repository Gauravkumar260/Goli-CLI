/**
 * spawn_subagent tool (H15 — Parallel Sub-Agents).
 *
 * Spawns a sub-agent with an isolated context window to work on a
 * subtask. When `use_worktree: true` (default for parallel calls),
 * the subagent runs in a git worktree — a separate working directory
 * sharing the same `.git` object store. This provides concurrency
 * isolation (no file conflicts) but is NOT a security boundary
 * (ADR-0036).
 *
 * ## Parallel execution
 *
 * `spawn_subagent` is in `PARALLEL_SAFE_TOOLS` — when the model emits
 * multiple `spawn_subagent` calls in one turn, they execute in parallel
 * (each in its own worktree). This is the key win over ADR-0035's
 * sequential pipeline: independent subtasks finish in `max(t_i)` instead
 * of `sum(t_i)`.
 *
 * ## Merge protocol
 *
 * Sub-agent results are NOT auto-merged. The tool returns a summary
 * (subagent ID, branch name, worktree path, result). The main agent
 * must call `merge_subagent` (or review the diff manually) before the
 * work lands on the target branch.
 *
 * ## Tool context callback
 *
 * The actual subagent spawn is delegated to `ctx.spawnSubagent`,
 * which the agent loop provides. This keeps the tool layer decoupled
 * from the agent loop construction (mirrors H14's `requestDiffApproval`
 * pattern).
 *
 * Permission tier: T2 (spawning agents is risky — they can make
 * unbounded tool calls within their own budget).
 *
 * @module tools/core/spawn-subagent
 */

import { randomUUID } from 'node:crypto';

import { ToolExecutionError } from '../../utils/errors.js';

import type { AgentRole } from '../../agent/types.js';
import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 * Input to the spawn_subagent callback.
 */
export interface SubagentSpawnInput {
  /** The subtask prompt. */
  prompt: string;
  /** The agent role. */
  role: AgentRole;
  /** Whether to create a git worktree for isolation (default: true). */
  useWorktree?: boolean;
  /** Optional subagent ID (auto-generated if not provided). */
  subagentId?: string;
  /** Optional branch name (auto-generated if not provided). */
  branchName?: string;
  /** Abort signal. */
  signal?: AbortSignal;
}

/**
 * Result of a subagent spawn.
 */
export interface SubagentResult {
  /** The subagent ID. */
  subagentId: string;
  /** Whether a worktree was created. */
  worktreeCreated: boolean;
  /** The worktree path (empty if no worktree). */
  worktreePath: string;
  /** The branch name (empty if no worktree). */
  branch: string;
  /** The subagent's final content. */
  content: string;
  /** Whether the subagent succeeded. */
  ok: boolean;
  /** Error message (if `ok` is false). */
  error?: string;
  /** Tokens consumed by the subagent. */
  totalTokens?: number;
  /** Wall-clock duration in ms. */
  durationMs?: number;
  /** Iterations the subagent ran. */
  iterations?: number;
}

/**
 *
 */
export const SPAWN_SUBAGENT_TOOL: Tool = {
  name: 'spawn_subagent',
  description:
    'Spawn a sub-agent to work on a subtask in parallel. The subagent gets its own context window, ' +
    'system prompt (based on role), and tool budget. By default, runs in a git worktree for filesystem ' +
    'isolation. Emit multiple spawn_subagent calls in one turn to run subtasks in parallel — they will ' +
    'execute concurrently (each in its own worktree). The main agent must review the subagent results ' +
    'and merge them (the tool does NOT auto-merge). Use this for independent subtasks like "implement ' +
    'the auth module" + "implement the user module" + "write tests for the API".',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The subtask prompt for the subagent. Be specific about what to implement, which files to touch, and what the expected output is.',
      },
      role: {
        type: 'string',
        enum: ['scout', 'researcher', 'architect', 'planner', 'implementer', 'debugger', 'qa-tester', 'security-auditor', 'reviewer', 'documenter'],
        description: 'The agent role. Use implementer for coding, qa-tester for tests, security-auditor for security review, researcher for investigation, documenter for docs.',
      },
      use_worktree: {
        type: 'boolean',
        description: 'If true (default), create a git worktree for filesystem isolation. Set to false for read-only subtasks that do not need isolation.',
      },
      subagent_id: {
        type: 'string',
        description: 'Optional subagent ID (auto-generated if not provided). Use this to reference the subagent later for merge/review.',
      },
      branch_name: {
        type: 'string',
        description: 'Optional branch name (auto-generated as agent-task-<id> if not provided).',
      },
    },
    required: ['prompt', 'role'],
    additionalProperties: false,
  },
  handler: spawnSubagentHandler,
  tier: 'T2',
  readOnly: false,
};

async function spawnSubagentHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const prompt = args['prompt'] as string;
  const role = args['role'] as AgentRole;
  const useWorktree = (args['use_worktree'] as boolean | undefined) ?? true;
  const subagentId = (args['subagent_id'] as string | undefined) ?? randomUUID().slice(0, 8);
  const branchName = args['branch_name'] as string | undefined;

  if (!prompt) {
    throw new ToolExecutionError('spawn_subagent requires a prompt', 'spawn_subagent');
  }
  if (!role) {
    throw new ToolExecutionError('spawn_subagent requires a role', 'spawn_subagent');
  }

  // Sandbox-mode check (MEDIUM-15). The previous implementation
  // allowed spawning subagents in `read-only` mode without
  // propagating the sandbox mode to the subagent's ToolContext.
  // A subagent spawned in read-only mode could then call `bash` /
  // `write_file` and mutate the workspace — bypassing the read-only
  // restriction the user set. We now refuse to spawn in read-only
  // mode unless god mode is active (god mode overrides everything).
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    throw new ToolExecutionError(
      'Cannot spawn subagent in read-only sandbox mode. ' +
        'Subagents inherit the parent sandbox mode; a read-only subagent ' +
        'would be unable to do useful work, and a write subagent would ' +
        'bypass the read-only restriction. Switch to workspace-write or ' +
        'danger-full-access before spawning.',
      'spawn_subagent',
    );
  }

  // The actual spawn is delegated to the ctx callback. This keeps the
  // tool layer decoupled from the agent loop construction.
  if (!ctx.spawnSubagent) {
    throw new ToolExecutionError(
      'spawn_subagent is not available in this context (no spawnSubagent callback on ToolContext). ' +
        'This likely means the agent loop was not configured with a subagent spawner. ' +
        'Pass a SubagentSpawner to AgentLoopOptions to enable spawn_subagent.',
      'spawn_subagent',
    );
  }

  // P1-3 fix (audit Finding CC-2 / 3.35): PRE-EXECUTION approval gate.
  // spawn_subagent is T2 (spawning agents is risky — they can make
  // unbounded tool calls in a worktree). In build mode with an
  // interactive approver wired (TUI), prompt BEFORE delegating to the
  // spawner. Fail-closed when no approver is wired in headless mode
  // UNLESS godMode/autoMode — the caller can use --auto or --god.
  if (ctx.requestApproval && !ctx.godMode && !ctx.autoMode) {
    const approvalDecision = await ctx.requestApproval({
      toolCallId: ctx.toolCallId,
      toolName: 'spawn_subagent',
      tier: 'T2',
      description: `spawn ${role} subagent${useWorktree ? ' in worktree' : ' in-process'} — ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`,
      args,
      timestamp: new Date().toISOString(),
    });
    if (!approvalDecision.approved) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `spawn_subagent denied by user${approvalDecision.reason ? `: ${approvalDecision.reason}` : ''}.`,
      };
    }
  }

  // Spec-mode and diff-review don't apply to subagents — they have
  // their own ToolContext with their own settings.
  const result: SubagentResult = await ctx.spawnSubagent({
    prompt,
    role,
    useWorktree,
    subagentId,
    branchName,
  });

  if (!result.ok) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Subagent ${result.subagentId} failed: ${result.error ?? 'unknown error'}`,
    };
  }

  // Format the result for the main agent.
  const summary =
    `Subagent ${result.subagentId} (${role}) completed.\n` +
    (result.worktreeCreated
      ? `Worktree: ${result.worktreePath}\nBranch: ${result.branch}\n`
      : 'No worktree (in-process).\n') +
    `Iterations: ${result.iterations ?? '?'}, Tokens: ${result.totalTokens ?? '?'}, Duration: ${result.durationMs ?? '?'}ms\n` +
    `Result:\n${result.content}`;

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: summary,
  };
}
