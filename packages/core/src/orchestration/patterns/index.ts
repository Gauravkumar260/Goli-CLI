/**
 * Orchestration patterns (Module 7).
 *
 * 5 production patterns:
 * - fan-out/fan-in: primary for 4+ independent tasks (75% wall-clock cut)
 * - supervisor: hub-spoke with arbiter
 * - handoff: sequential pipeline (the 11-agent swarm)
 * - debate: high-stakes only; two agents with opposing constraints
 * - swarm: avoid (87% failure rate)
 *
 * @module orchestration/patterns
 */

import type { AgentRole } from '../../agent/types.js';
import type { Subtask, OrchestrationPattern, TaskDecomposition } from '../types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** The result of running an orchestration pattern. */
export interface OrchestrationResult {
  /** The pattern used. */
  pattern: OrchestrationPattern;
  /** The subtask results. */
  subtaskResults: Array<{
    subtaskId: string;
    role: AgentRole;
    ok: boolean;
    output: string;
    durationMs: number;
  }>;
  /** Total wall-clock duration. */
  totalDurationMs: number;
  /** Whether the overall task succeeded. */
  ok: boolean;
}

/** Options for the OrchestrationPatterns. */
export interface OrchestrationPatternsOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Max parallel subagents (default: 4). */
  maxParallel?: number;
  /** A function to run a single subagent. */
  runSubagent?: (subtask: Subtask) => Promise<{ ok: boolean; output: string; durationMs: number }>;
}

/** The orchestration patterns — runs subtasks according to the selected pattern. */
export class OrchestrationPatterns {
  private readonly log?: Logger;
  private readonly maxParallel: number;
  private readonly runSubagent?: OrchestrationPatternsOptions['runSubagent'];

  constructor(opts: OrchestrationPatternsOptions = {}) {
    this.log = opts.logger;
    this.maxParallel = opts.maxParallel ?? 4;
    this.runSubagent = opts.runSubagent;
  }

  /**
   * Run subtasks according to the specified pattern.
   * @param decomposition
   * @param pattern
   */
  async run(
    decomposition: TaskDecomposition,
    pattern?: OrchestrationPattern,
  ): Promise<OrchestrationResult> {
    const effectivePattern = pattern ?? decomposition.pattern;
    const startTime = Date.now();

    this.log?.info('Running orchestration', {
      pattern: effectivePattern,
      subtaskCount: decomposition.subtasks.length,
      parallel: decomposition.parallelRecommended,
    });

    let results: OrchestrationResult['subtaskResults'];

    switch (effectivePattern) {
      case 'fan-out-fan-in':
        results = await this.fanOutFanIn(decomposition.subtasks);
        break;
      case 'supervisor':
        results = await this.supervisor(decomposition.subtasks);
        break;
      case 'handoff':
        results = await this.handoff(decomposition.subtasks);
        break;
      case 'debate':
        results = await this.debate(decomposition.subtasks);
        break;
      case 'swarm':
        this.log?.warn('Swarm pattern selected — 87% failure rate. Consider fan-out-fan-in instead.');
        results = await this.fanOutFanIn(decomposition.subtasks); // Fall back to fan-out
        break;
      case 'single-loop':
      default:
        results = await this.handoff(decomposition.subtasks);
        break;
    }

    const totalDurationMs = Date.now() - startTime;
    const ok = results.every((r) => r.ok);

    return { pattern: effectivePattern, subtaskResults: results, totalDurationMs, ok };
  }

  /**
   * Fan-out/fan-in: run independent subtasks in parallel, merge results.
   *
   * Best for: 4+ independent tasks. 75% wall-clock reduction.
   * @param subtasks
   */
  private async fanOutFanIn(subtasks: Subtask[]): Promise<OrchestrationResult['subtaskResults']> {
    const independent = subtasks.filter((s) => s.independent);
    const dependent = subtasks.filter((s) => !s.independent);

    const results: OrchestrationResult['subtaskResults'] = [];

    // Run dependent tasks first (sequentially)
    for (const subtask of dependent) {
      results.push(await this.runOne(subtask));
    }

    // Run independent tasks in parallel (up to maxParallel at a time)
    const batches: Subtask[][] = [];
    for (let i = 0; i < independent.length; i += this.maxParallel) {
      batches.push(independent.slice(i, i + this.maxParallel));
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map((s) => this.runOne(s)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Supervisor: hub-spoke with arbiter. Each subtask runs, then the
   * supervisor reviews and decides whether to accept or retry.
   * @param subtasks
   */
  private async supervisor(subtasks: Subtask[]): Promise<OrchestrationResult['subtaskResults']> {
    const results: OrchestrationResult['subtaskResults'] = [];

    for (const subtask of subtasks) {
      let attempts = 0;
      let result;

      do {
        result = await this.runOne(subtask);
        attempts++;

        if (!result.ok && attempts < 2) {
          this.log?.info('Supervisor: retrying subtask', { subtaskId: subtask.id, attempt: attempts });
        }
      } while (!result.ok && attempts < 2); // Max 2 attempts (autonomous recovery)

      results.push(result);
    }

    return results;
  }

  /**
   * Handoff: sequential pipeline. Each subtask's output is the next
   * subtask's input. This is the 11-agent swarm pattern.
   *
   * The previous implementation called `this.runOne(subtask)`
   * independently for each subtask, passing only the original
   * `subtask.description`. The previous subtask's `output` was
   * NEVER injected into the next subtask's prompt — the handoff
   * pattern was functionally identical to a plain sequential
   * loop. We now thread the previous result's `output` into the
   * next subtask's `description` so the next agent sees what its
   * upstream produced.
   * @param subtasks
   */
  private async handoff(subtasks: Subtask[]): Promise<OrchestrationResult['subtaskResults']> {
    const results: OrchestrationResult['subtaskResults'] = [];
    let accumulatedOutput = '';

    for (const subtask of subtasks) {
      // Inject the previous subtask's output into this subtask's
      // prompt so the next agent sees its upstream's work.
      const enrichedSubtask: Subtask = accumulatedOutput
        ? {
            ...subtask,
            description: `${subtask.description}\n\n--- Previous agent output ---\n${accumulatedOutput}`,
          }
        : subtask;
      const result = await this.runOne(enrichedSubtask);
      results.push(result);

      if (result.ok && result.output) {
        accumulatedOutput = result.output;
      } else if (!result.ok) {
        this.log?.warn('Handoff: subtask failed, continuing with remaining tasks', {
          subtaskId: subtask.id,
        });
      }
    }

    return results;
  }

  /**
   * Debate: two agents with opposing constraints. The supervisor
   * arbitrates. Use only for high-stakes architectural decisions.
   * @param subtasks
   */
  private async debate(subtasks: Subtask[]): Promise<OrchestrationResult['subtaskResults']> {
    if (subtasks.length < 2) {
      return this.handoff(subtasks);
    }

    // Run two agents in parallel with different perspectives
    const [agent1, agent2] = subtasks.slice(0, 2);
    const [result1, result2] = await Promise.all([
      this.runOne(agent1!),
      this.runOne(agent2!),
    ]);

    // Supervisor arbitrates: pick the better result. The previous
    // implementation always fell back to `result1` when both agents
    // failed, masking the failure and reporting a winner with
    // `ok: false`. The downstream `ok` computation still saw
    // `false`, but the "winner" concept was misleading. We now
    // explicitly mark the winner as failed when both agents failed,
    // and pick whichever result has more output (or the first if
    // equal) when both succeed.
    let winner: typeof result1;
    if (result1.ok && !result2.ok) {
      winner = result1;
    } else if (result2.ok && !result1.ok) {
      winner = result2;
    } else if (result1.ok && result2.ok) {
      // Both succeeded — pick the longer output (more useful).
      winner = (result1.output?.length ?? 0) >= (result2.output?.length ?? 0) ? result1 : result2;
    } else {
      // Both failed — pick result1 but mark explicitly as failed.
      winner = { ...result1, output: `[Both debate agents failed — arbitrator picked result1 as a placeholder. agent1 error: ${result1.output ?? 'unknown'}, agent2 error: ${result2.output ?? 'unknown'}]` };
    }
    const results = [winner];

    // Run remaining subtasks sequentially
    for (const subtask of subtasks.slice(2)) {
      results.push(await this.runOne(subtask));
    }

    return results;
  }

  /**
   * Run a single subagent (uses the provided runSubagent or a stub).
   * @param subtask
   */
  private async runOne(subtask: Subtask): Promise<{
    subtaskId: string;
    role: AgentRole;
    ok: boolean;
    output: string;
    durationMs: number;
  }> {
    if (this.runSubagent) {
      const result = await this.runSubagent(subtask);
      return {
        subtaskId: subtask.id,
        role: subtask.role,
        ok: result.ok,
        output: result.output,
        durationMs: result.durationMs,
      };
    }

    // Stub: simulate execution
    const durationMs = 1000 + Math.floor(Math.random() * 3000);
    await new Promise((resolve) => setTimeout(resolve, 10)); // Minimal delay for tests
    return {
      subtaskId: subtask.id,
      role: subtask.role,
      ok: true,
      output: `Completed: ${subtask.description.slice(0, 50)}`,
      durationMs,
    };
  }
}
