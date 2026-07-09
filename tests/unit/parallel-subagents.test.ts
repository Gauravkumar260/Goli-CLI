/**
 * Unit tests for H15: Parallel Sub-Agents.
 *
 * Verifies:
 *   - spawn_subagent tool calls the ctx.spawnSubagent callback
 *   - spawn_subagent throws when no callback is set
 *   - spawn_subagent validates prompt and role
 *   - spawn_subagent is in PARALLEL_SAFE_TOOLS (parallel-eligible)
 *   - spawn_subagent is NOT in NEVER_PARALLEL_TOOLS
 *   - shouldParallelizeToolBatch returns true for multiple spawn_subagent calls
 *   - SubagentResult is formatted correctly in the tool output
 */

import { describe, it, expect } from 'vitest';

import { SPAWN_SUBAGENT_TOOL } from '../../packages/core/src/tools/core/spawn-subagent.js';
import {
  PARALLEL_SAFE_TOOLS,
  NEVER_PARALLEL_TOOLS,
  shouldParallelizeToolBatch,
} from '../../packages/core/src/tools/parallel-execution.js';

import type { ToolCall } from '../../packages/core/src/agent/types.js';
import type { SubagentSpawnInput, SubagentResult } from '../../packages/core/src/tools/core/spawn-subagent.js';
import type { ToolContext } from '../../packages/core/src/tools/types.js';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: 'test-tc',
    workspaceRoot: '/tmp/test-workspace',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
    ...overrides,
  };
}

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

describe('H15 spawn_subagent tool', () => {
  it('is registered as parallel-safe', () => {
    expect(PARALLEL_SAFE_TOOLS.has('spawn_subagent')).toBe(true);
  });

  it('is NOT in never-parallel set', () => {
    expect(NEVER_PARALLEL_TOOLS.has('spawn_subagent')).toBe(false);
  });

  it('calls the ctx.spawnSubagent callback', async () => {
    let capturedInput: SubagentSpawnInput | undefined;
    const ctx = makeContext({
      spawnSubagent: async (input) => {
        capturedInput = input;
        return {
          subagentId: input.subagentId ?? 'test-id',
          worktreeCreated: true,
          worktreePath: '/tmp/wt-test',
          branch: 'agent-task-test',
          content: 'subagent finished successfully',
          ok: true,
          totalTokens: 1000,
          durationMs: 5000,
          iterations: 3,
        };
      },
    });
    const result = await SPAWN_SUBAGENT_TOOL.handler(
      { prompt: 'implement the auth module', role: 'implementer' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.prompt).toBe('implement the auth module');
    expect(capturedInput!.role).toBe('implementer');
    expect(capturedInput!.useWorktree).toBe(true);
    expect(result.content).toContain('subagent finished successfully');
    expect(result.content).toContain('agent-task-test');
  });

  it('throws when no spawnSubagent callback is set', async () => {
    const ctx = makeContext(); // no spawnSubagent
    await expect(
      SPAWN_SUBAGENT_TOOL.handler(
        { prompt: 'do something', role: 'implementer' },
        ctx,
      ),
    ).rejects.toThrow('spawn_subagent is not available');
  });

  it('throws when prompt is missing', async () => {
    const ctx = makeContext({
      spawnSubagent: async () => ({}) as SubagentResult,
    });
    await expect(
      SPAWN_SUBAGENT_TOOL.handler(
        { prompt: '', role: 'implementer' },
        ctx,
      ),
    ).rejects.toThrow('requires a prompt');
  });

  it('throws when role is missing', async () => {
    const ctx = makeContext({
      spawnSubagent: async () => ({}) as SubagentResult,
    });
    await expect(
      SPAWN_SUBAGENT_TOOL.handler(
        { prompt: 'do something', role: '' as never },
        ctx,
      ),
    ).rejects.toThrow('requires a role');
  });

  it('returns error result when subagent fails', async () => {
    const ctx = makeContext({
      spawnSubagent: async () => ({
        subagentId: 'failed-id',
        worktreeCreated: false,
        worktreePath: '',
        branch: '',
        content: '',
        ok: false,
        error: 'budget exceeded',
      }),
    });
    const result = await SPAWN_SUBAGENT_TOOL.handler(
      { prompt: 'do something', role: 'implementer' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('budget exceeded');
  });

  it('respects use_worktree=false', async () => {
    let capturedInput: SubagentSpawnInput | undefined;
    const ctx = makeContext({
      spawnSubagent: async (input) => {
        capturedInput = input;
        return {
          subagentId: 'test',
          worktreeCreated: false,
          worktreePath: '',
          branch: '',
          content: 'done',
          ok: true,
        };
      },
    });
    await SPAWN_SUBAGENT_TOOL.handler(
      { prompt: 'read-only task', role: 'researcher', use_worktree: false },
      ctx,
    );
    expect(capturedInput!.useWorktree).toBe(false);
  });

  it('passes through subagent_id and branch_name', async () => {
    let capturedInput: SubagentSpawnInput | undefined;
    const ctx = makeContext({
      spawnSubagent: async (input) => {
        capturedInput = input;
        return {
          subagentId: input.subagentId!,
          worktreeCreated: true,
          worktreePath: '/tmp/wt',
          branch: input.branchName!,
          content: 'done',
          ok: true,
        };
      },
    });
    await SPAWN_SUBAGENT_TOOL.handler(
      {
        prompt: 'task',
        role: 'implementer',
        subagent_id: 'my-id',
        branch_name: 'feature-branch',
      },
      ctx,
    );
    expect(capturedInput!.subagentId).toBe('my-id');
    expect(capturedInput!.branchName).toBe('feature-branch');
  });
});

describe('H15 parallelization of spawn_subagent batches', () => {
  it('shouldParallelizeToolBatch returns true for multiple spawn_subagent calls', () => {
    const calls = [
      makeToolCall('spawn_subagent', { prompt: 'task1', role: 'implementer' }),
      makeToolCall('spawn_subagent', { prompt: 'task2', role: 'implementer' }),
      makeToolCall('spawn_subagent', { prompt: 'task3', role: 'qa-tester' }),
    ];
    const decision = shouldParallelizeToolBatch(calls);
    expect(decision.shouldParallelize).toBe(true);
    expect(decision.parallelizable).toHaveLength(3);
    expect(decision.sequential).toHaveLength(0);
  });

  it('shouldParallelizeToolBatch returns false for a single spawn_subagent', () => {
    const calls = [
      makeToolCall('spawn_subagent', { prompt: 'task1', role: 'implementer' }),
    ];
    const decision = shouldParallelizeToolBatch(calls);
    // Single call → no benefit from parallelization
    expect(decision.shouldParallelize).toBe(false);
  });

  it('shouldParallelizeToolBatch mixes spawn_subagent with read_file', () => {
    const calls = [
      makeToolCall('spawn_subagent', { prompt: 'task1', role: 'implementer' }),
      makeToolCall('read_file', { file_path: '/tmp/foo.txt' }),
      makeToolCall('spawn_subagent', { prompt: 'task2', role: 'qa-tester' }),
    ];
    const decision = shouldParallelizeToolBatch(calls);
    expect(decision.shouldParallelize).toBe(true);
    expect(decision.parallelizable).toHaveLength(3);
  });

  it('shouldParallelizeToolBatch falls back to sequential when bash is in the batch', () => {
    const calls = [
      makeToolCall('spawn_subagent', { prompt: 'task1', role: 'implementer' }),
      makeToolCall('bash', { command: 'ls' }),
      makeToolCall('spawn_subagent', { prompt: 'task2', role: 'implementer' }),
    ];
    const decision = shouldParallelizeToolBatch(calls);
    // bash is never-parallel → entire batch runs sequential
    expect(decision.shouldParallelize).toBe(false);
    expect(decision.sequential).toHaveLength(3);
  });
});
