/**
 * Multi-agent orchestration types (Module 7).
 *
 * Defines the data structures for the 11-agent swarm pipeline, task
 * decomposition, worktree isolation, shared-state coordination, and
 * orchestration patterns.
 *
 * @module orchestration/types
 */

import type { AgentRole } from '@goli-cli/shared';

/** An orchestration pattern. */
export type OrchestrationPattern =
  | 'single-loop'     // Default: single-threaded ReAct loop (Phase 2)
  | 'fan-out-fan-in'  // Primary: 4+ independent tasks, 75% wall-clock cut
  | 'supervisor'      // Hub-spoke with arbiter
  | 'handoff'         // Sequential pipeline (the 11-agent swarm)
  | 'debate'          // High-stakes only; two agents with opposing constraints
  | 'swarm';          // Avoid — 87% failure rate

/** A decomposed subtask. */
export interface Subtask {
  /** Unique subtask ID. */
  id: string;
  /** The task description. */
  description: string;
  /** The agent role best suited for this subtask. */
  role: AgentRole;
  /** Whether this subtask is independent (can run in parallel). */
  independent: boolean;
  /** IDs of subtasks this depends on. */
  dependsOn: string[];
  /** The expected output. */
  expectedOutput: string;
  /** Priority (higher = more important). */
  priority: number;
  /** Optional workspace root override (set when worktree isolation is used). */
  workspaceRoot?: string;
}

/** A task decomposition result. */
export interface TaskDecomposition {
  /** The original task. */
  task: string;
  /** The decomposed subtasks. */
  subtasks: Subtask[];
  /** The recommended orchestration pattern. */
  pattern: OrchestrationPattern;
  /** Whether parallel execution is recommended. */
  parallelRecommended: boolean;
  /** Hotspot files that multiple subtasks would modify (force sequential). */
  hotspotFiles: string[];
}

/** A shared-state entry (blackboard pattern). */
export interface BlackboardEntry {
  /** Unique entry ID. */
  id: string;
  /** The subtask this entry belongs to. */
  subtaskId: string;
  /** The agent that wrote this entry. */
  agentRole: AgentRole;
  /** The entry type. */
  type: 'proposal' | 'validation' | 'commit' | 'status';
  /** The entry content. */
  content: string;
  /** The entry status. */
  status: 'pending' | 'validated' | 'committed' | 'rejected';
  /** Timestamp (ISO 8601). */
  timestamp: string;
}

/** A model routing decision.
 *
 * MEDIUM-58: the `effort` field's documented mapping (low/high/max
 * ↔ routine/complex/hard) contradicted the actual values. The
 * previous comment said "low for routine, high for complex, max for
 * hard" but `TaskComplexity = 'routine' | 'complex' | 'hard'` and
 * `effort = 'low' | 'high' | 'max'` — so 'high' was mapped to
 * 'complex' (correct), but 'low' → 'routine' and 'max' → 'hard'
 * were inverted in some call sites that branched on the wrong axis.
 * We clarify the mapping here so callers don't second-guess it.
 */
export interface RoutingDecision {
  /** The model to use. */
  model: string;
  /**
   * The reasoning effort.
   *
   * Mapping to `complexity`:
   *   - `'low'`  ↔ `complexity: 'routine'` (fast/cheap model, 1-shot)
   *   - `'high'` ↔ `complexity: 'complex'` (default, multi-step ReAct)
   *   - `'max'`  ↔ `complexity: 'hard'`    (deep reasoning, multi-iteration)
   *
   * Use `effort` to drive model selection and `complexity` to drive
   * orchestration (e.g. `'hard'` tasks get a supervisor pattern).
   */
  effort: 'low' | 'high' | 'max';
  /** The complexity classification. */
  complexity: TaskComplexity;
  /** Whether a fallback was used. */
  fallback: boolean;
  /** The latency overhead in ms. */
  latencyMs: number;
  /** The token overhead. */
  tokenOverhead: number;
}

/** Task complexity classification. */
export type TaskComplexity = 'routine' | 'complex' | 'hard';

/** A cloud sandbox session. */
export interface CloudSandboxSession {
  /** The sandbox ID. */
  sandboxId: string;
  /** The provider (e2b or firecracker-self-hosted). */
  provider: 'e2b' | 'firecracker-self-hosted';
  /** The repo preloaded into the sandbox. */
  repoUrl?: string;
  /** The sandbox status. */
  status: 'creating' | 'ready' | 'executing' | 'destroyed';
  /** The creation timestamp. */
  createdAt: string;
  /** The destruction timestamp. */
  destroyedAt?: string;
}

/** The 11-agent swarm pipeline stages. */
export const SWARM_PIPELINE: Array<{ role: AgentRole; label: string; phase: string }> = [
  { role: 'scout', label: 'Scout', phase: 'Scoping' },
  { role: 'researcher', label: 'Researcher', phase: 'Researching' },
  { role: 'architect', label: 'Architect', phase: 'Architecting' },
  { role: 'planner', label: 'Planner', phase: 'Planning' },
  { role: 'implementer', label: 'Implementer', phase: 'Executing' },
  { role: 'debugger', label: 'Debugger', phase: 'Debugging' },
  { role: 'qa-tester', label: 'QA / Tester', phase: 'Testing' },
  { role: 'security-auditor', label: 'Security Auditor', phase: 'Security Scanning' },
  { role: 'reviewer', label: 'Reviewer', phase: 'Reviewing' },
  { role: 'orchestrator', label: 'Orchestrator', phase: 'Merging' },
  { role: 'documenter', label: 'Documenter', phase: 'Documenting' },
];

/** Default orchestration config. */
export const DEFAULT_ORCHESTRATION_CONFIG = {
  defaultPattern: 'handoff' as OrchestrationPattern,
  maxParallelSubagents: 4,
  hotspotFiles: ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'],
  classifierOverheadTokens: 210,
  classifierLatencyMs: 430,
};
