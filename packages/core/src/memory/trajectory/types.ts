/**
 * Trajectory logging types (Module 5, part 3).
 *
 * Every agent run is logged as a structured trajectory: the task,
 * each step (thinking, action, observation), tool calls, outcome,
 * tokens, cost, and duration. These trajectories are the training
 * data for GRPO + LoRA fine-tuning.
 *
 * @module memory/trajectory/types
 */

/** A single step in a trajectory. */
export interface TrajectoryStep {
  /** The step ID (0-indexed). */
  stepId: number;
  /** The agent's thinking (reasoning_content from the model). */
  thinking?: string;
  /** The action taken (tool call). */
  action: {
    /** The tool name. */
    tool: string;
    /** The tool arguments (parsed). */
    arguments: Record<string, unknown>;
  };
  /** The observation (tool result). */
  observation: string;
  /** Whether the tool call succeeded. */
  ok: boolean;
  /** Token usage for this step. */
  tokensUsed: {
    input: number;
    output: number;
    thinking: number;
  };
  /** Duration in ms. */
  durationMs: number;
}

/** A complete trajectory (one agent run). */
export interface Trajectory {
  /** Unique trajectory ID. */
  trajectoryId: string;
  /** The task description (user prompt). */
  taskDescription: string;
  /** The model used (e.g. 'gpt-4o'). */
  model: string;
  /** The reasoning effort (low/high/max). */
  effort: string;
  /** The agent role. */
  role: string;
  /** The steps taken. */
  steps: TrajectoryStep[];
  /** The outcome. */
  outcome: TrajectoryOutcome;
  /** Whether tests passed (for reward computation). */
  testsPassed?: boolean;
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** The session ID. */
  sessionId: string;
  /** The workspace root. */
  workspaceRoot: string;
}

/** The outcome of a trajectory. */
export type TrajectoryOutcome = 'success' | 'failure' | 'aborted' | 'budget_exceeded' | 'stall' | 'error';

/** A curated dataset for fine-tuning. */
export interface TrainingDataset {
  /** The dataset name. */
  name: string;
  /** The training examples. */
  examples: TrainingExample[];
  /** The number of source trajectories. */
  sourceTrajectoryCount: number;
  /** The creation timestamp. */
  createdAt: string;
  /** The curation strategy used. */
  strategy: CurationStrategy;
}

/** A single training example (prompt + completion). */
export interface TrainingExample {
  /** The prompt (system + user messages). */
  prompt: string;
  /** The ideal completion (the successful trajectory's actions). */
  completion: string;
  /** The reward score (0.0 – 1.0). */
  reward: number;
  /** The source trajectory ID. */
  sourceTrajectoryId: string;
}

/** The curation strategy for building a training dataset. */
export type CurationStrategy = 'rejection_sampling' | 'best_of_n' | 'all_successes';

/** The reward function components. */
export interface RewardComponents {
  /** Primary reward: did tests pass? (0 or 1) */
  testsPass: number;
  /** Efficiency bonus: fewer tokens = higher reward (0.0 – 0.3) */
  efficiency: number;
  /** Safety penalty: hook violations reduce reward (-0.5 – 0.0) */
  safetyPenalty: number;
  /** The total reward (testsPass + efficiency + safetyPenalty). */
  total: number;
}

/** Options for the TrajectoryStore. */
export interface TrajectoryStoreOptions {
  /** The trajectories directory (default: ~/.agent/trajectories/). */
  trajectoriesDir?: string;
  /** Whether to use in-memory mode (for tests). */
  inMemory?: boolean;
}

/** Options for the TrajectoryCurator. */
export interface TrajectoryCuratorOptions {
  /** The trajectory store. */
  store: import('./store.js').TrajectoryStore;
  /** Max rollouts per task for rejection sampling (default: 30). */
  maxRollouts?: number;
  /** Max iterations (default: 2, per SWE-Gym research). */
  maxIterations?: number;
  /** Logger instance. */
  logger?: import('../../utils/logger.js').Logger;
}

/** Options for the RewardFunction. */
export interface RewardFunctionOptions {
  /** Max tokens for full efficiency bonus (default: 10000). */
  maxTokensForBonus?: number;
  /** Safety penalty per hook violation (default: -0.1). */
  safetyPenaltyPerViolation?: number;
}
