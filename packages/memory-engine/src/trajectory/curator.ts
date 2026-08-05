/**
 * Trajectory curator (Module 5, part 3).
 *
 * Implements rejection sampling: for each task, generate N high-
 * temperature rollouts, keep only the successful ones, and build
 * a training dataset. Per SWE-Gym research, 2 iterations max
 * (diminishing returns after that).
 *
 * ## Rejection Sampling (RFT) Process
 *
 * 1. For each unique task in the trajectory store:
 *    a. Find all rollouts (trajectories with the same task)
 *    b. Keep only successful ones (outcome = 'success')
 *    c. Compute reward for each (tests pass + efficiency + safety)
 *    d. Select the highest-reward rollout(s) for the training set
 * 2. Build a TrainingDataset from the selected trajectories
 * 3. Repeat for up to 2 iterations (SWE-Gym: diminishing returns after 2)
 *
 * @module memory/trajectory/curator
 */

import { computeReward, shouldKeepForTraining } from '../training/reward.js';

import type { TrajectoryStore } from './store.js';
import type {
  Trajectory,
  TrainingDataset,
  TrainingExample,
  CurationStrategy,
} from './types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** The TrajectoryCurator — builds training datasets via rejection sampling. */
export class TrajectoryCurator {
  private readonly store: TrajectoryStore;
  private readonly maxRollouts: number;
  private readonly maxIterations: number;
  private readonly log?: Logger;

  constructor(opts: {
    store: TrajectoryStore;
    maxRollouts?: number;
    maxIterations?: number;
    logger?: Logger;
  }) {
    this.store = opts.store;
    this.maxRollouts = opts.maxRollouts ?? 30;
    this.maxIterations = opts.maxIterations ?? 2;
    this.log = opts.logger;
  }

  /**
   * Curate a training dataset via rejection sampling.
   *
   * @param rewardThreshold - The minimum reward to keep (default: 0.5).
   * @param strategy - The curation strategy (default: rejection_sampling).
   * @returns The curated training dataset.
   */
  curate(
    rewardThreshold: number = 0.5,
    strategy: CurationStrategy = 'rejection_sampling',
  ): TrainingDataset {
    this.log?.info('Curating training dataset', {
      strategy,
      rewardThreshold,
      maxRollouts: this.maxRollouts,
      maxIterations: this.maxIterations,
    });

    // Get all successful trajectories
    const successful = this.store.getSuccessful(1000);
    this.log?.info('Found successful trajectories', { count: successful.length });

    if (successful.length === 0) {
      return {
        name: `curated-${Date.now()}`,
        examples: [],
        sourceTrajectoryCount: 0,
        createdAt: new Date().toISOString(),
        strategy,
      };
    }

    // Group by task description (fuzzy — first 50 chars as key)
    const taskGroups = new Map<string, typeof successful>();
    for (const traj of successful) {
      const key = (traj.taskDescription ?? '').slice(0, 50).toLowerCase();
      if (!taskGroups.has(key)) taskGroups.set(key, []);
      taskGroups.get(key)!.push(traj);
    }

    this.log?.info('Grouped by task', { taskCount: taskGroups.size });

    // For each task group, select the best rollouts
    const examples: TrainingExample[] = [];
    let sourceCount = 0;

    for (const [, trajectories] of taskGroups) {
      // Limit to maxRollouts per task
      const rollouts = trajectories.slice(0, this.maxRollouts);
      sourceCount += rollouts.length;

      // Compute rewards and filter. Cache fullTraj by trajectoryId
      // so the conversion loop below doesn't re-scan the JSONL.
      // The previous implementation called `getById` once here to
      // compute the reward, and then AGAIN in the conversion loop
      // below — each call scans the entire JSONL file. For 1,000
      // successful trajectories, this was 2,000 full JSONL scans.
      const fullTrajCache = new Map<string, Trajectory | null>();

      const kept: Array<{ trajectory: typeof rollouts[0]; reward: ReturnType<typeof computeReward>; fullTraj: Trajectory }> = [];

      for (const traj of rollouts) {
        const tid = traj.trajectoryId ?? '';
        let fullTraj = fullTrajCache.get(tid) ?? null;
        if (!fullTrajCache.has(tid)) {
          fullTraj = this.store.getById(tid);
          fullTrajCache.set(tid, fullTraj);
        }
        if (!fullTraj) continue;

        const reward = computeReward(fullTraj);
        if (shouldKeepForTraining(fullTraj, reward, rewardThreshold)) {
          kept.push({ trajectory: traj, reward, fullTraj });
        }
      }

      // Sort by reward (highest first) and take the best
      kept.sort((a, b) => b.reward.total - a.reward.total);

      // For rejection_sampling: keep top 1 per task
      // For best_of_n: keep top 3 per task
      // For all_successes: keep all that passed
      const topN = strategy === 'best_of_n' ? 3 : strategy === 'all_successes' ? kept.length : 1;
      const selected = kept.slice(0, topN);

      // Convert to training examples. Reuse the cached fullTraj
      // from the reward loop — no second JSONL scan needed.
      for (const { reward, fullTraj } of selected) {
        examples.push(this.toTrainingExample(fullTraj, reward.total));
      }
    }

    this.log?.info('Curation complete', {
      sourceTrajectories: sourceCount,
      examples: examples.length,
      strategy,
    });

    return {
      name: `curated-${Date.now()}`,
      examples,
      sourceTrajectoryCount: sourceCount,
      createdAt: new Date().toISOString(),
      strategy,
    };
  }

  /**
   * Convert a trajectory to a training example (prompt + completion).
   * @param trajectory
   * @param reward
   */
  private toTrainingExample(trajectory: Trajectory, reward: number): TrainingExample {
    // Build the prompt (system + user message)
    const prompt = [
      `Task: ${trajectory.taskDescription}`,
      `Model: ${trajectory.model}`,
      `Effort: ${trajectory.effort}`,
    ].join('\n');

    // Build the completion (the sequence of tool calls)
    const completion = trajectory.steps
      .map((step, i) => {
        const args = JSON.stringify(step.action.arguments);
        return `Step ${i + 1}: ${step.action.tool}(${args})\n  Result: ${step.observation.slice(0, 200)}`;
      })
      .join('\n');

    return {
      prompt,
      completion,
      reward,
      sourceTrajectoryId: trajectory.trajectoryId,
    };
  }

  /**
   * Get the curation statistics.
   */
  getStats(): {
    totalTrajectories: number;
    successfulTrajectories: number;
    uniqueTasks: number;
    avgReward: number;
  } {
    const stats = this.store.getStats();
    const successful = stats.byOutcome['success'] ?? 0;
    return {
      totalTrajectories: stats.total,
      successfulTrajectories: successful,
      uniqueTasks: 0, // Would need a query for this
      avgReward: 0, // Would need to compute for all
    };
  }
}
