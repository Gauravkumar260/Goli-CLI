/**
 * Reward function (Module 5, part 3).
 *
 * Computes the reward for a trajectory. The reward is used by GRPO
 * (Group Relative Policy Optimization) to determine which rollouts
 * to reinforce.
 *
 * ## Reward Components
 *
 * 1. **Tests pass** (primary, 0 or 1): did the task's tests pass?
 * 2. **Efficiency bonus** (0.0 – 0.3): fewer tokens = higher reward.
 *    Encourages the agent to be concise.
 * 3. **Safety penalty** (-0.5 – 0.0): hook violations reduce reward.
 *    Discourages the agent from attempting unsafe operations.
 *
 * Total = testsPass + efficiency + safetyPenalty
 *
 * @module memory/training/reward
 */

import type { Trajectory, RewardComponents } from '../trajectory/types.js';

/** Default max tokens for full efficiency bonus. */
const DEFAULT_MAX_TOKENS_FOR_BONUS = 10_000;

/** Default safety penalty per hook violation. */
const DEFAULT_SAFETY_PENALTY = -0.1;

/** Max efficiency bonus. */
const MAX_EFFICIENCY_BONUS = 0.3;

/** Max safety penalty (floor). */
const MAX_SAFETY_PENALTY = -0.5;

/**
 * Compute the reward for a trajectory.
 *
 * @param trajectory - The trajectory to evaluate.
 * @param hookViolations - The number of hook violations (safety penalty).
 * @param opts - Reward function options.
 * @param opts.maxTokensForBonus
 * @param opts.safetyPenaltyPerViolation
 */
export function computeReward(
  trajectory: Trajectory,
  hookViolations: number = 0,
  opts: {
    maxTokensForBonus?: number;
    safetyPenaltyPerViolation?: number;
  } = {},
): RewardComponents {
  const maxTokens = opts.maxTokensForBonus ?? DEFAULT_MAX_TOKENS_FOR_BONUS;
  const penaltyPerViolation = opts.safetyPenaltyPerViolation ?? DEFAULT_SAFETY_PENALTY;

  // 1. Tests pass (primary reward: 0 or 1)
  const testsPass = trajectory.testsPassed === true ? 1 : 0;

  // 2. Efficiency bonus (0.0 – 0.3): fewer tokens = higher reward
  // Linear interpolation: 0 tokens → 0.3 bonus, maxTokens → 0.0 bonus
  const efficiency = Math.max(
    0,
    MAX_EFFICIENCY_BONUS * (1 - trajectory.totalTokens / maxTokens),
  );

  // 3. Safety penalty (-0.5 – 0.0): hook violations reduce reward
  const rawPenalty = hookViolations * penaltyPerViolation;
  const safetyPenalty = rawPenalty === 0 ? 0 : Math.max(MAX_SAFETY_PENALTY, rawPenalty);

  // Total
  const total = testsPass + efficiency + safetyPenalty;

  return {
    testsPass,
    efficiency,
    safetyPenalty,
    total,
  };
}

/**
 * Check if a trajectory should be kept for training (rejection sampling).
 *
 * A trajectory is kept if:
 * - It was successful (outcome = 'success')
 * - Its reward is above the threshold (default: 0.5)
 *
 * @param trajectory - The trajectory to check.
 * @param reward - The computed reward.
 * @param threshold - The minimum reward to keep (default: 0.5).
 */
export function shouldKeepForTraining(
  trajectory: Trajectory,
  reward: RewardComponents,
  threshold: number = 0.5,
): boolean {
  return trajectory.outcome === 'success' && reward.total >= threshold;
}
