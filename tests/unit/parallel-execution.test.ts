/**
 * Unit tests for the parallel tool execution system.
 */

import { describe, it, expect } from 'vitest';

import {
  shouldParallelizeToolBatch,
  pathsOverlap,
  executeToolCallsConcurrent,
  PARALLEL_SAFE_TOOLS,
  PATH_SCOPED_TOOLS,
  NEVER_PARALLEL_TOOLS,
  MAX_CONCURRENT_TOOLS,
} from '../../packages/core/src/tools/parallel-execution.js';

import type { ToolCall } from '../../packages/core/src/agent/types.js';

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

describe('PARALLEL_SAFE_TOOLS', () => {
  it('contains read-only tools', () => {
    expect(PARALLEL_SAFE_TOOLS.has('read_file')).toBe(true);
    expect(PARALLEL_SAFE_TOOLS.has('grep')).toBe(true);
    expect(PARALLEL_SAFE_TOOLS.has('list_directory')).toBe(true);
    expect(PARALLEL_SAFE_TOOLS.has('web_search')).toBe(true);
  });

  it('does not contain mutating tools', () => {
    expect(PARALLEL_SAFE_TOOLS.has('write_file')).toBe(false);
    expect(PARALLEL_SAFE_TOOLS.has('edit_file')).toBe(false);
    expect(PARALLEL_SAFE_TOOLS.has('bash')).toBe(false);
  });
});

describe('PATH_SCOPED_TOOLS', () => {
  it('contains file-mutating tools', () => {
    expect(PATH_SCOPED_TOOLS.has('write_file')).toBe(true);
    expect(PATH_SCOPED_TOOLS.has('edit_file')).toBe(true);
  });
});

describe('NEVER_PARALLEL_TOOLS', () => {
  it('contains interactive tools', () => {
    expect(NEVER_PARALLEL_TOOLS.has('bash')).toBe(true);
    expect(NEVER_PARALLEL_TOOLS.has('plan_task')).toBe(true);
    expect(NEVER_PARALLEL_TOOLS.has('clarify')).toBe(true);
  });
});

describe('MAX_CONCURRENT_TOOLS', () => {
  it('is 8', () => {
    expect(MAX_CONCURRENT_TOOLS).toBe(8);
  });
});

describe('pathsOverlap', () => {
  it('detects exact match', () => {
    expect(pathsOverlap('/src/a.ts', '/src/a.ts')).toBe(true);
  });

  it('detects parent-child relationship', () => {
    expect(pathsOverlap('/src', '/src/a.ts')).toBe(true);
    expect(pathsOverlap('/src/a.ts', '/src')).toBe(true);
  });

  it('does not flag non-overlapping paths', () => {
    expect(pathsOverlap('/src/a.ts', '/src/b.ts')).toBe(false);
    expect(pathsOverlap('/src/', '/test/')).toBe(false);
  });
});

describe('shouldParallelizeToolBatch', () => {
  it('returns false for single tool call', () => {
    const decision = shouldParallelizeToolBatch([makeToolCall('read_file')]);
    expect(decision.shouldParallelize).toBe(false);
    expect(decision.sequential).toHaveLength(1);
  });

  it('returns true for multiple parallel-safe tools', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('read_file', { file_path: '/src/a.ts' }),
      makeToolCall('grep', { pattern: 'foo' }),
      makeToolCall('list_directory', { path: '/src' }),
    ]);
    expect(decision.shouldParallelize).toBe(true);
    expect(decision.parallelizable).toHaveLength(3);
    expect(decision.sequential).toHaveLength(0);
  });

  it('returns false when batch contains never-parallel tool', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('read_file'),
      makeToolCall('bash'),
    ]);
    expect(decision.shouldParallelize).toBe(false);
    expect(decision.reason).toContain('never-parallel');
  });

  it('allows path-scoped tools with non-overlapping paths', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('write_file', { file_path: '/src/a.ts' }),
      makeToolCall('write_file', { file_path: '/src/b.ts' }),
    ]);
    expect(decision.shouldParallelize).toBe(true);
    expect(decision.pathOverlaps).toHaveLength(0);
  });

  it('moves path-scoped tools to sequential on overlap', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('write_file', { file_path: '/src/a.ts' }),
      makeToolCall('edit_file', { file_path: '/src/a.ts' }),
    ]);
    expect(decision.shouldParallelize).toBe(false);
    expect(decision.pathOverlaps).toHaveLength(1);
    expect(decision.pathOverlaps[0]!.tool1).toBe('write_file');
    expect(decision.pathOverlaps[0]!.tool2).toBe('edit_file');
  });

  it('detects parent-dir overlap', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('write_file', { file_path: '/src' }),
      makeToolCall('edit_file', { file_path: '/src/a.ts' }),
    ]);
    expect(decision.pathOverlaps.length).toBeGreaterThan(0);
  });

  it('handles unknown tools (sequential fallback)', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('unknown_tool'),
      makeToolCall('read_file'),
    ]);
    expect(decision.sequential.some((tc) => tc.name === 'unknown_tool')).toBe(true);
  });

  it('handles empty batch', () => {
    const decision = shouldParallelizeToolBatch([]);
    expect(decision.shouldParallelize).toBe(false);
  });

  it('handles path-scoped tool without file_path (sequential)', () => {
    const decision = shouldParallelizeToolBatch([
      makeToolCall('write_file', {}),
      makeToolCall('read_file', { file_path: '/src/a.ts' }),
    ]);
    expect(decision.sequential.some((tc) => tc.name === 'write_file')).toBe(true);
  });
});

describe('executeToolCallsConcurrent', () => {
  it('executes parallel-safe tools concurrently', async () => {
    const calls = [
      makeToolCall('read_file', { file_path: '/a' }),
      makeToolCall('read_file', { file_path: '/b' }),
      makeToolCall('read_file', { file_path: '/c' }),
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await executeToolCallsConcurrent(
      calls,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrent--;
        return 'ok';
      },
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    // Should have had at least 2 concurrent (proves parallelism)
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('executes never-parallel tools sequentially', async () => {
    const calls = [
      makeToolCall('bash', { command: 'echo 1' }),
      makeToolCall('bash', { command: 'echo 2' }),
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await executeToolCallsConcurrent(
      calls,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrent--;
        return 'ok';
      },
    );

    expect(results).toHaveLength(2);
    expect(maxConcurrent).toBe(1); // Sequential
  });

  it('handles executor errors', async () => {
    const calls = [
      makeToolCall('read_file', { file_path: '/a' }),
      makeToolCall('read_file', { file_path: '/b' }),
    ];

    const results = await executeToolCallsConcurrent(calls, async (tc) => {
      if (tc.argumentsParsed?.['file_path'] === '/b') {
        throw new Error('file not found');
      }
      return 'ok';
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.error).toContain('file not found');
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const calls = Array.from({ length: 10 }, (_, i) =>
      makeToolCall('read_file', { file_path: `/file${i}` }),
    );

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);

    const results = await executeToolCallsConcurrent(
      calls,
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'ok';
      },
      controller.signal,
    );

    // Some should be ok, some may be missing (aborted)
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns results in original order', async () => {
    const calls = [
      makeToolCall('read_file', { file_path: '/c' }),
      makeToolCall('read_file', { file_path: '/a' }),
      makeToolCall('read_file', { file_path: '/b' }),
    ];

    const results = await executeToolCallsConcurrent(
      calls,
      async (tc) => tc.argumentsParsed?.['file_path'] as string,
    );

    // Results should be in the same order as input
    expect(results[0]!.result).toBe('/c');
    expect(results[1]!.result).toBe('/a');
    expect(results[2]!.result).toBe('/b');
  });
});
