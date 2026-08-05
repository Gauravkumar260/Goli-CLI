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

  // 2. Efficiency bonus (0.0 – 0.3): fewer tokens = higher reward.
  //
  // CRITICAL: only award the efficiency bonus when tests pass. The
  // previous implementation awarded the bonus unconditionally — an
  // empty completion (0 tokens, tests failed) got the FULL 0.3
  // efficiency bonus, which incentivized the model to emit empty
  // responses. This is the classic "reward hacking" failure mode.
  // We now gate the efficiency bonus on `testsPass === 1`.
  const efficiency = testsPass === 1
    ? Math.max(0, MAX_EFFICIENCY_BONUS * (1 - trajectory.totalTokens / maxTokens))
    : 0;

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
 * ## Threshold vs total range
 *
 * The default threshold (0.5) is calibrated for the case where
 * `testsPass = 1` and `efficiency = 0.3` (total = 1.3) — well above
 * 0.5. A failed trajectory has `testsPass = 0`, `efficiency = 0`
 * (after the MEDIUM-38 fix), and a non-positive safety penalty, so
 * its total is ≤ 0 — well below 0.5. The threshold correctly
 * separates the two cases.
 *
 * The previous implementation's threshold of 0.5 was coincidentally
 * correct after the MEDIUM-38 fix; before the fix, an empty
 * completion got `testsPass = 0 + efficiency = 0.3 = 0.3`, which is
 * below 0.5 — so the bug was masked by the threshold. After the fix,
 * an empty completion gets `testsPass = 0 + efficiency = 0 = 0`,
 * which is correctly rejected.
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
