/**
 * SICA (Self-Improving Coding Agent) types (Module 5, part 4).
 *
 * SICA lets the agent treat its own system prompt, tool descriptions,
 * context-engineering prompts, hook configs, TODO logic, and skill
 * definitions as editable state. It evaluates proposed changes against
 * benchmarks and adopts improvements — all guarded by an immutable
 * safety registry and an LLM-based overseer.
 *
 * ## The SICA Loop
 *
 *   Evaluate → Archive → Self-Edit → Guard → Re-evaluate → Adopt/Revert
 *
 * 1. **Evaluate**: run the current version against a benchmark subset
 * 2. **Archive**: snapshot the current version (append-only)
 * 3. **Self-Edit**: the agent proposes changes to its own code/prompts
 * 4. **Guard**: the immutable safety registry + LLM overseer review the diff
 * 5. **Re-evaluate**: run the modified version against the same benchmark
 * 6. **Adopt/Revert**: if the benchmark improved AND the holdout didn't
 *    degrade AND the overseer approved → adopt; otherwise → revert
 *
 * ## Guardrails
 *
 * - **Immutable safety registry**: filesystem read-only mounts protecting
 *   sandbox configs, approval engine, hook scripts, SICA evaluation
 *   harness, benchmark scoring logic.
 * - **LLM-based overseer**: separate GLM-5.2 instance with veto power.
 *   Checks for: safety-check disabling, benchmark overfitting, sandbox
 *   boundary expansion, logging removal.
 * - **Test-gated adoption**: full test suite must pass AND benchmark must
 *   improve — no sideways changes.
 * - **Overfitting detection**: separate holdout set the optimizer never
 *   sees; reject changes that help benchmark but hurt holdout.
 * - **Rate limiting**: max 10 SICA cycles/day, human review for any
 *   change >50 LOC.
 * - **Rollback**: any prior version restorable from the append-only archive.
 *
 * @module memory/sica/types
 */

/** What the agent can self-edit. */
export type SicaTarget =
  | 'system_prompt' // The SystemPromptAssembler fragments
  | 'tool_description' // A tool's description field
  | 'context_prompt' // Context-engineering prompts (compaction, etc.)
  | 'hook_config' // Hook configurations
  | 'todo_logic' // The planner's TODO management logic
  | 'skill_definition'; // A SKILL.md file

/** A proposed change to the agent's own code/prompts. */
export interface SicaProposal {
  /** Unique proposal ID. */
  proposalId: string;
  /** What is being changed. */
  target: SicaTarget;
  /** The target's name (e.g. fragment name, tool name, skill name). */
  targetName: string;
  /** The current content (before the change). */
  oldContent: string;
  /** The proposed new content (after the change). */
  newContent: string;
  /** A diff representation (unified diff). */
  diff: string;
  /** The number of lines changed. */
  linesChanged: number;
  /** Why the agent proposes this change. */
  rationale: string;
  /** When the proposal was created. */
  timestamp: string;
}

/** The result of evaluating a version against a benchmark. */
export interface SicaEvaluation {
  /** The benchmark name (e.g. 'swe-bench-verified-50'). */
  benchmark: string;
  /** The resolution rate (0.0 – 1.0). */
  resolutionRate: number;
  /** The number of instances evaluated. */
  instanceCount: number;
  /** The number of instances resolved. */
  resolvedCount: number;
  /** The semantic error rate (0.0 – 1.0). */
  semanticErrorRate: number;
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Duration in ms. */
  durationMs: number;
  /** When the evaluation was run. */
  timestamp: string;
}

/** The result of the LLM overseer's review. */
export interface OverseerVerdict {
  /** Whether the overseer approves the proposal. */
  approved: boolean;
  /** The overseer's reasoning. */
  reasoning: string;
  /** Specific concerns identified. */
  concerns: OverseerConcern[];
  /** The severity of the worst concern. */
  maxSeverity: 'info' | 'warning' | 'critical';
}

/** A concern identified by the overseer. */
export interface OverseerConcern {
  /** The category of concern. */
  category: OverseerConcernCategory;
  /** The severity. */
  severity: 'info' | 'warning' | 'critical';
  /** Description of the concern. */
  description: string;
}

/** Categories of overseer concerns. */
export type OverseerConcernCategory =
  | 'safety_check_disabled' // Removed or weakened a safety check
  | 'benchmark_overfitting' // Change helps benchmark but likely hurts generalization
  | 'sandbox_boundary_expanded' // Expanded sandbox permissions
  | 'logging_removed' // Removed audit logging
  | 'approval_weakened' // Weakened the approval policy
  | 'immutable_registry_modified' // Attempted to modify the immutable registry
  | 'hardcoded_answer' // Hardcoded a benchmark answer
  | 'other'; // Other concern

/** The result of a SICA cycle. */
export interface SicaCycleResult {
  /** The proposal that was evaluated. */
  proposal: SicaProposal;
  /** The evaluation before the change. */
  beforeEvaluation: SicaEvaluation;
  /** The evaluation after the change. */
  afterEvaluation: SicaEvaluation;
  /** The overseer's verdict. */
  overseerVerdict: OverseerVerdict;
  /** Whether the change was adopted. */
  adopted: boolean;
  /** Why the change was adopted or reverted. */
  reason: string;
  /** The delta in resolution rate (after - before). */
  resolutionDelta: number;
  /** Whether the holdout degraded. */
  holdoutDegraded: boolean;
  /** When the cycle completed. */
  timestamp: string;
}

/** An entry in the append-only archive. */
export interface ArchiveEntry {
  /** Unique archive entry ID. */
  entryId: string;
  /** The version number (monotonic). */
  version: number;
  /** The target that was changed. */
  target: SicaTarget;
  /** The target name. */
  targetName: string;
  /** The content at this version. */
  content: string;
  /** The proposal that led to this version (if any). */
  proposalId?: string;
  /** Whether this version was adopted or reverted. */
  status: 'adopted' | 'reverted' | 'initial';
  /** When the entry was archived. */
  timestamp: string;
}

/** Options for the SICA loop. */
export interface SicaLoopOptions {
  /** Max cycles per day (default: 10). */
  maxCyclesPerDay?: number;
  /** LOC threshold for human review (default: 50). */
  humanReviewLocThreshold?: number;
  /** Minimum resolution improvement to adopt (default: 0.01 = 1%). */
  minResolutionImprovement?: number;
  /** Max allowed holdout degradation (default: 0.02 = 2%). */
  maxHoldoutDegradation?: number;
  /** Whether SICA is enabled (default: false — must be explicitly enabled). */
  enabled?: boolean;
}

/** The default SICA options. */
export const DEFAULT_SICA_OPTIONS: Required<SicaLoopOptions> = {
  maxCyclesPerDay: 10,
  humanReviewLocThreshold: 50,
  minResolutionImprovement: 0.01,
  maxHoldoutDegradation: 0.02,
  enabled: false, // SICA is disabled by default — must be explicitly enabled
};
