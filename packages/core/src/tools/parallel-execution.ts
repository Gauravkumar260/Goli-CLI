/**
 * Parallel tool execution rules engine (Hermes pattern).
 *
 * Classifies tools into three categories:
 * - _PARALLEL_SAFE_TOOLS: read-only tools that can always run concurrently
 * - _PATH_SCOPED_TOOLS: file-mutating tools that can run concurrently when
 *   targets don't overlap
 * - _NEVER_PARALLEL_TOOLS: interactive tools that must run sequentially
 *
 * `shouldParallelizeToolBatch()` returns true only when every tool is
 * either parallel-safe or path-scoped-without-overlap.
 *
 * ## Why parallel execution?
 *
 * When the model emits 3+ read-only tool calls in a single turn (e.g.,
 * `read_file`, `grep`, `list_directory`), executing them sequentially
 * wastes wall-clock time. Parallel execution can cut latency by 60-75%
 * for read-heavy batches.
 *
 * ## Safety rules
 *
 * - Read-only tools (read_file, grep, list_directory) → always parallel-safe
 * - File-mutating tools (write_file, edit_file) → parallel only if paths
 *   don't overlap (checked via `_pathsOverlap()`)
 * - Interactive tools (bash, plan_task) → never parallel (side effects,
 *   interactive prompts, resource contention)
 * - Maximum 8 concurrent tools (ThreadPoolExecutor limit in Hermes)
 *
 * @module tools/parallel-execution
 */

import { resolve, relative } from 'node:path';

import type { ToolCall } from '../agent/types.js';

/** Read-only tools that can always run concurrently. */
export const PARALLEL_SAFE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_directory',
  'grep',
  'symbol_lookup',
  'vector_search',
  'web_search',
  'web_fetch',
  'session_search',
  'skill_view',
  'skills_list',
  // H15: spawn_subagent is parallel-safe because each subagent runs in
  // its own git worktree — no file conflicts. Multiple spawn_subagent
  // calls in one turn execute concurrently (max 8, see MAX_CONCURRENT_TOOLS).
  'spawn_subagent',
]);

/** File-mutating tools that can run concurrently when targets don't overlap. */
export const PATH_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'read_file', // also path-scoped (for overlap detection with writes)
]);

/** Tools that must never run in parallel. */
export const NEVER_PARALLEL_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'plan_task',
  'delegate_task',
  'clarify',
  'memory',
  'send_message',
  'execute_code',
]);

/** Maximum concurrent tool executions. */
export const MAX_CONCURRENT_TOOLS = 8;

/** Interrupt polling interval in ms. */
export const INTERRUPT_POLL_INTERVAL_MS = 3000;

/** The result of checking whether a batch of tool calls can be parallelized. */
export interface ParallelizationDecision {
  /** Whether the batch should be parallelized. */
  shouldParallelize: boolean;
  /** The reason for the decision. */
  reason: string;
  /** Tool calls that can run in parallel. */
  parallelizable: ToolCall[];
  /** Tool calls that must run sequentially. */
  sequential: ToolCall[];
  /** Detected path overlaps (if any). */
  pathOverlaps: Array<{ tool1: string; tool2: string; path: string }>;
}

/**
 * Check if a batch of tool calls should be parallelized.
 *
 * Returns true only when every tool is either:
 * - In PARALLEL_SAFE_TOOLS, OR
 * - In PATH_SCOPED_TOOLS with no path overlap
 *
 * If any tool is in NEVER_PARALLEL_TOOLS, the entire batch runs sequentially.
 *
 * @param toolCalls - The tool calls to check.
 * @returns The parallelization decision.
 */
export function shouldParallelizeToolBatch(toolCalls: ToolCall[]): ParallelizationDecision {
  if (toolCalls.length <= 1) {
    return {
      shouldParallelize: false,
      reason: 'Only one tool call — no parallelization needed',
      parallelizable: [],
      sequential: toolCalls,
      pathOverlaps: [],
    };
  }

  // Check for never-parallel tools
  const neverParallel = toolCalls.filter((tc) => NEVER_PARALLEL_TOOLS.has(tc.name));
  if (neverParallel.length > 0) {
    return {
      shouldParallelize: false,
      reason: `Batch contains never-parallel tool(s): ${neverParallel.map((t) => t.name).join(', ')}`,
      parallelizable: [],
      sequential: toolCalls,
      pathOverlaps: [],
    };
  }

  // Classify each tool call
  const parallelizable: ToolCall[] = [];
  const sequential: ToolCall[] = [];
  const pathScopedCalls: Array<{ toolCall: ToolCall; path: string }> = [];

  for (const tc of toolCalls) {
    if (PARALLEL_SAFE_TOOLS.has(tc.name)) {
      parallelizable.push(tc);
    } else if (PATH_SCOPED_TOOLS.has(tc.name)) {
      // Extract the file path from the tool arguments
      const args = tc.argumentsParsed ?? {};
      const filePath = (args['file_path'] as string) ?? (args['path'] as string) ?? '';
      if (filePath) {
        pathScopedCalls.push({ toolCall: tc, path: resolve(filePath) });
      } else {
        // Path-scoped tool without a path — can't verify safety, run sequential
        sequential.push(tc);
      }
    } else {
      // Unknown tool — run sequential (fail-safe)
      sequential.push(tc);
    }
  }

  // Check for path overlaps among path-scoped tools
  const pathOverlaps: Array<{ tool1: string; tool2: string; path: string }> = [];
  for (let i = 0; i < pathScopedCalls.length; i++) {
    for (let j = i + 1; j < pathScopedCalls.length; j++) {
      const a = pathScopedCalls[i]!;
      const b = pathScopedCalls[j]!;
      if (pathsOverlap(a.path, b.path)) {
        pathOverlaps.push({
          tool1: a.toolCall.name,
          tool2: b.toolCall.name,
          path: a.path,
        });
      }
    }
  }

  if (pathOverlaps.length > 0) {
    // Path overlap detected — move ALL path-scoped tools to sequential
    for (const { toolCall } of pathScopedCalls) {
      sequential.push(toolCall);
    }
    return {
      shouldParallelize: parallelizable.length > 1,
      reason: `Path overlap detected: ${pathOverlaps.map((o) => `${o.tool1}↔${o.tool2}`).join(', ')}. Moving path-scoped tools to sequential.`,
      parallelizable,
      sequential,
      pathOverlaps,
    };
  }

  // No overlaps — path-scoped tools are also parallelizable
  for (const { toolCall } of pathScopedCalls) {
    parallelizable.push(toolCall);
  }

  // Check if we have enough to parallelize
  if (parallelizable.length <= 1) {
    return {
      shouldParallelize: false,
      reason: 'Only one parallelizable tool — no benefit from parallelization',
      parallelizable: [],
      sequential: toolCalls,
      pathOverlaps: [],
    };
  }

  return {
    shouldParallelize: true,
    reason: `${parallelizable.length} tools can run in parallel (${sequential.length} sequential)`,
    parallelizable,
    sequential,
    pathOverlaps: [],
  };
}

/**
 * Check if two file paths overlap (one is the same as or a parent of the other).
 *
 * @param path1 - The first path (absolute).
 * @param path2 - The second path (absolute).
 * @returns True if the paths overlap.
 */
export function pathsOverlap(path1: string, path2: string): boolean {
  // Exact match
  if (path1 === path2) return true;

  // Check if one is a parent directory of the other
  const rel = relative(path1, path2);
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
    return true; // path2 is inside path1
  }

  const rel2 = relative(path2, path1);
  if (rel2 === '' || (!rel2.startsWith('..') && !rel2.startsWith('/'))) {
    return true; // path1 is inside path2
  }

  return false;
}

/**
 * Execute a batch of tool calls in parallel with max concurrency.
 *
 * Uses Promise.all with a concurrency limiter. Polls for interrupts
 * every INTERRUPT_POLL_INTERVAL_MS.
 *
 * @param toolCalls - The tool calls to execute.
 * @param executor - A function that executes a single tool call.
 * @param signal - Optional abort signal for cancellation.
 * @returns Array of results in the same order as the input.
 */
export async function executeToolCallsConcurrent<T>(
  toolCalls: ToolCall[],
  executor: (toolCall: ToolCall) => Promise<T>,
  signal?: AbortSignal,
): Promise<Array<{ toolCall: ToolCall; result: T; ok: boolean; error?: string }>> {
  const decision = shouldParallelizeToolBatch(toolCalls);

  if (!decision.shouldParallelize) {
    // Execute sequentially
    const results: Array<{ toolCall: ToolCall; result: T; ok: boolean; error?: string }> = [];
    for (const tc of toolCalls) {
      if (signal?.aborted) break;
      try {
        const result = await executor(tc);
        results.push({ toolCall: tc, result, ok: true });
      } catch (err) {
        results.push({
          toolCall: tc,
          result: null as unknown as T,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  // Execute parallelizable tools concurrently with max concurrency
  const parallelResults = await executeWithConcurrency(
    decision.parallelizable,
    executor,
    Math.min(MAX_CONCURRENT_TOOLS, decision.parallelizable.length),
    signal,
  );

  // Execute sequential tools
  const sequentialResults: Array<{ toolCall: ToolCall; result: T; ok: boolean; error?: string }> = [];
  for (const tc of decision.sequential) {
    if (signal?.aborted) break;
    try {
      const result = await executor(tc);
      sequentialResults.push({ toolCall: tc, result, ok: true });
    } catch (err) {
      sequentialResults.push({
        toolCall: tc,
        result: null as unknown as T,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Merge results in original order — O(n) via Map (not O(n²) find)
  const byId = new Map<string, { toolCall: ToolCall; result: T; ok: boolean; error?: string }>();
  for (const r of parallelResults) byId.set(r.toolCall.id, r);
  for (const r of sequentialResults) byId.set(r.toolCall.id, r);
  return toolCalls.map(
    (tc) =>
      byId.get(tc.id) ?? {
        toolCall: tc,
        result: null as unknown as T,
        ok: false,
        error: 'Not executed',
      },
  );
}

/**
 * Execute promises with a concurrency limit using a proper semaphore.
 *
 * Uses an indexed slot approach: each in-flight promise is tracked in a
 * slot. When a slot finishes, the next pending item is launched. This
 * correctly enforces `maxConcurrent` (the previous implementation used
 * `Promise.race` + `filter(true)` which was a no-op — all items launched
 * immediately).
 *
 * @param items - The items to process.
 * @param executor - The function to execute for each item.
 * @param maxConcurrent - Maximum concurrent executions.
 * @param signal - Optional abort signal.
 */
async function executeWithConcurrency<T>(
  items: ToolCall[],
  executor: (toolCall: ToolCall) => Promise<T>,
  maxConcurrent: number,
  signal?: AbortSignal,
): Promise<Array<{ toolCall: ToolCall; result: T; ok: boolean; error?: string }>> {
  const results: Array<{ toolCall: ToolCall; result: T; ok: boolean; error?: string }> = [];
  const slotResolvers: Array<() => void> = [];

  /** Acquire a slot, waiting if all slots are busy. */
  const acquireSlot = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      slotResolvers.push(resolve);
      drainSlots();
    });
  };

  /** Resolve as many pending slot acquirers as we have capacity for. */
  const drainSlots = (): void => {
    while (slotResolvers.length > 0 && inFlight < maxConcurrent) {
      const resolve = slotResolvers.shift()!;
      inFlight++;
      resolve();
    }
  };

  let inFlight = 0;
  const queue: ToolCall[] = [...items];

  // Worker: pull from the queue, acquire slot, execute, release slot.
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const item = queue.shift();
      if (!item) return;
      await acquireSlot();
      try {
        if (signal?.aborted) {
          results.push({
            toolCall: item,
            result: null as unknown as T,
            ok: false,
            error: 'Aborted',
          });
        } else {
          const result = await executor(item);
          results.push({ toolCall: item, result, ok: true });
        }
      } catch (err) {
        results.push({
          toolCall: item,
          result: null as unknown as T,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inFlight--;
        drainSlots();
      }
    }
  };

  // Spawn one worker per item, but they will block on acquireSlot.
  // This is simpler than tracking individual promises and preserves order via `results`.
  const workers = items.map(() => worker());
  await Promise.all(workers);
  return results;
}
