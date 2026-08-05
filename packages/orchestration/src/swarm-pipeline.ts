/**
 * 11-agent swarm pipeline (Module 7).
 *
 * The Scout-Plan-Execute-Verify lifecycle:
 *
 *   Scout → Researcher → Architect → Planner → Implementer →
 *   Debugger → QA/Tester → Security Auditor → Reviewer →
 *   Orchestrator → Documenter
 *
 * Each agent is an AgentLoop instance (Phase 2) with a specialized
 * system prompt and tool set. The pipeline runs sequentially (handoff
 * pattern) — each agent's output is the next agent's input context.
 *
 * ## Why sequential (not parallel)?
 *
 * - 15× lower token cost than default-multi-agent
 * - 37% fewer coordination failures
 * - 1M context raises the bar for "too big for one agent"
 * - Parallel subagents are opt-in (fan-out/fan-in) for genuinely
 *   independent subtasks
 *
 * @module orchestration/swarm-pipeline
 */

import { TaskSplitter } from './decompose/task-splitter.js';
import { OrchestrationPatterns } from './patterns/index.js';
import { ComplexityClassifier } from './routing/classifier.js';
import { SharedBlackboard } from './shared-state/blackboard.js';
import { SWARM_PIPELINE, type TaskDecomposition } from './types.js';
import { WorktreeIsolation } from './worktree/isolation.js';

import type { OrchestrationResult } from './patterns/index.js';
import type { AgentRole } from '@goli-cli/shared';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for the SwarmPipeline. */
export interface SwarmPipelineOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The workspace root. */
  workspaceRoot: string;
  /** Whether to use worktree isolation (default: false — single-threaded). */
  useWorktrees?: boolean;
  /**
   * A function to run a single agent. The optional `workspaceRoot`
   * parameter is the worktree path to operate in — when worktree
   * isolation is enabled, this MUST be passed to the agent runner so
   * parallel agents write to their own worktree, not the shared main
   * workspace. The previous signature omitted this parameter, so
   * `subtask.workspaceRoot` was silently discarded and all parallel
   * agents clobbered each other in the main workspace.
   */
  runAgent?: (
    role: AgentRole,
    prompt: string,
    workspaceRoot?: string,
  ) => Promise<{ ok: boolean; output: string; durationMs: number }>;
}

/** The 11-agent swarm pipeline. */
export class SwarmPipeline {
  private readonly log?: Logger;
  private readonly workspaceRoot: string;
  private readonly useWorktrees: boolean;
  private readonly runAgent?: SwarmPipelineOptions['runAgent'];
  private readonly splitter: TaskSplitter;
  private readonly classifier: ComplexityClassifier;
  private readonly blackboard: SharedBlackboard;
  private readonly patterns: OrchestrationPatterns;
  private worktreeIsolation?: WorktreeIsolation;

  constructor(opts: SwarmPipelineOptions) {
    this.log = opts.logger;
    this.workspaceRoot = opts.workspaceRoot;
    this.useWorktrees = opts.useWorktrees ?? false;
    this.runAgent = opts.runAgent;

    this.splitter = new TaskSplitter();
    this.classifier = new ComplexityClassifier({ logger: this.log });
    this.blackboard = new SharedBlackboard({ logger: this.log });
    this.patterns = new OrchestrationPatterns({
      logger: this.log,
      runSubagent: this.runAgent
        ? async (subtask) => {
            // Forward subtask.workspaceRoot to the agent runner so
            // parallel agents operate in their own worktree. Without
            // this, worktree isolation is silently broken — every
            // parallel agent writes to the main workspaceRoot and
            // they clobber each other.
            return this.runAgent!(subtask.role, subtask.description, subtask.workspaceRoot);
          }
        : undefined,
    });

    if (this.useWorktrees) {
      this.worktreeIsolation = new WorktreeIsolation({
        workspaceRoot: this.workspaceRoot,
        logger: this.log,
      });
    }
  }

  /**
   * Wake up the swarm to perform a task.
   *
   * This is the primary entry point — `goli wakeup "your task"`.
   *
   * @param task - The task to perform.
   * @returns The orchestration result.
   */
  async wakeup(task: string): Promise<{
    ok: boolean;
    pattern: string;
    routingDecision: ReturnType<ComplexityClassifier['route']>;
    pipelineStages: Array<{ role: AgentRole; label: string; phase: string; completed: boolean }>;
    result: OrchestrationResult;
    decomposition: TaskDecomposition;
  }> {
    this.log?.info('Swarm waking up', { task: task.slice(0, 100) });

    // 1. Route the task (complexity classification)
    const routingDecision = this.classifier.route(task);
    this.log?.info('Task routed', {
      complexity: routingDecision.complexity,
      model: routingDecision.model,
      effort: routingDecision.effort,
    });

    // 2. Decompose the task
    const decomposition = this.splitter.decompose(task);
    this.log?.info('Task decomposed', {
      subtaskCount: decomposition.subtasks.length,
      pattern: decomposition.pattern,
      parallel: decomposition.parallelRecommended,
    });

    // 3. Verify no blocked providers (legal gate).
    // Pass the model name to isProviderAllowed — the check now uses
    // word-boundary regex so it correctly blocks `gpt-4o`, `claude-3`,
    // etc. (not just `openai`/`anthropic` substrings).
    if (!this.classifier.isProviderAllowed(routingDecision.model)) {
      this.log?.error('Blocked provider in routing decision', { model: routingDecision.model });
      throw new Error(`Provider '${routingDecision.model}' is blocked (ToS competing-product clause). Only open-weight models are allowed.`);
    }

    // 4. If worktree isolation is enabled, create a worktree for each
    //    parallel subtask. The previous implementation constructed
    //    WorktreeIsolation but NEVER called `create()` — worktrees were
    //    set up but never used, and `cleanup()` iterated an empty map.
    const worktreeMap = new Map<string, { path: string; branch: string }>();
    if (this.worktreeIsolation && decomposition.parallelRecommended) {
      for (const subtask of decomposition.subtasks) {
        if (subtask.independent) {
          const wt = this.worktreeIsolation.create(subtask.id);
          if (wt.created) {
            worktreeMap.set(subtask.id, { path: wt.path, branch: wt.branch });
            subtask.workspaceRoot = wt.path;
          }
        }
      }
    }

    // 5. Run the orchestration pattern.
    // 6/8. Cleanup is in a `finally` block so a throwing subagent
    // does not leak orphaned worktrees on disk. The previous
    // implementation ran `this.patterns.run` outside any
    // try/finally, so any throw skipped merge + remove + cleanup,
    // leaving `git worktree` entries that accumulated across
    // sessions.
    let result: OrchestrationResult | undefined;
    try {
      result = await this.patterns.run(decomposition);
      if (!result) {
        // Should never happen — patterns.run always returns a result.
        // But TS can't prove it across the `finally` boundary.
        throw new Error('Orchestration patterns.run returned no result');
      }
    } finally {
      if (this.worktreeIsolation && worktreeMap.size > 0) {
        for (const [subtaskId] of worktreeMap) {
          const subtaskResult = result?.subtaskResults.find((r) => r.subtaskId === subtaskId);
          if (subtaskResult?.ok) {
            // Merge the subtask's branch back into the main workspace.
            // If the merge fails (e.g., conflict), PRESERVE the
            // worktree so a human can recover the work — the
            // previous implementation removed the worktree
            // unconditionally, force-discarding all uncommitted
            // work on merge failure.
            const merged = this.worktreeIsolation.merge(subtaskId);
            if (!merged) {
              this.log?.error(
                'Worktree merge failed — preserving worktree for manual recovery',
                { subtaskId },
              );
              continue; // Do NOT remove — let the user resolve the conflict.
            }
          }
          this.worktreeIsolation.remove(subtaskId);
        }
      }
      // 8. Cleanup any remaining worktrees if used.
      if (this.worktreeIsolation) {
        this.worktreeIsolation.cleanup();
      }
    }
    // After try/finally, `result` is guaranteed defined — if
    // `patterns.run` had thrown, the try/finally would have
    // re-thrown after cleanup.
    const orchestrationResult = result as OrchestrationResult;

    // 7. Build the pipeline stages report
    const pipelineStages = SWARM_PIPELINE.map((stage) => ({
      ...stage,
      completed: orchestrationResult.subtaskResults.some((r) => r.role === stage.role && r.ok),
    }));

    this.log?.info('Swarm complete', {
      ok: orchestrationResult.ok,
      pattern: orchestrationResult.pattern,
      durationMs: orchestrationResult.totalDurationMs,
      stages: pipelineStages.filter((s) => s.completed).length,
    });

    return {
      ok: orchestrationResult.ok,
      pattern: orchestrationResult.pattern,
      routingDecision,
      pipelineStages,
      result: orchestrationResult,
      decomposition,
    };
  }

  /** Get the shared blackboard (for inspection). */
  getBlackboard(): SharedBlackboard {
    return this.blackboard;
  }

  /** Get the complexity classifier. */
  getClassifier(): ComplexityClassifier {
    return this.classifier;
  }

  /** Get the 11-agent pipeline stages. */
  getPipelineStages(): typeof SWARM_PIPELINE {
    return SWARM_PIPELINE;
  }
}
