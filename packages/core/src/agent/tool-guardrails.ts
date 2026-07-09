/**
 * Tool-call loop guardrails (Hermes pattern).
 *
 * Per-turn controller that detects tool-call loops beyond the simple
 * 3-identical-call stall detector (Phase 2). Tracks:
 *
 * - **Exact failure**: same tool + same args failing repeatedly
 * - **Same-tool failure**: same tool failing (different args)
 * - **No-progress**: tool calls that don't change the working tree
 *
 * Side-effect free — returns `ToolGuardrailDecision` for the runtime
 * to apply (warn, halt, or inject synthetic result).
 *
 * ## Thresholds (Hermes defaults)
 *
 * - exact_failure_warn_after: 2
 * - exact_failure_block_after: 5
 * - same_tool_failure_warn_after: 3
 * - same_tool_failure_halt_after: 8
 * - no_progress_warn_after: 2
 * - no_progress_block_after: 5
 *
 * ## Tool classification
 *
 * - IDEMPOTENT_TOOL_NAMES: read-only tools that can be called repeatedly
 *   without side effects (read_file, grep, list_directory)
 * - MUTATING_TOOL_NAMES: tools that change state (write_file, edit_file,
 *   bash) — repeated calls with same args may indicate a loop
 *
 * @module agent/tool-guardrails
 */

import { sortObjectKeys } from '../utils/json-utils.js';

import type { ToolCall } from './types.js';

/** Configuration for the tool-call guardrails. */
export interface ToolGuardrailConfig {
  /** Warn after N exact failures (same tool + same args). */
  exactFailureWarnAfter: number;
  /** Block after N exact failures. */
  exactFailureBlockAfter: number;
  /** Warn after N same-tool failures (different args). */
  sameToolFailureWarnAfter: number;
  /** Halt after N same-tool failures. */
  sameToolFailureHaltAfter: number;
  /** Warn after N no-progress calls (no working-tree change). */
  noProgressWarnAfter: number;
  /** Block after N no-progress calls. */
  noProgressBlockAfter: number;
}

/** Default guardrail config (Hermes defaults). */
export const DEFAULT_GUARDRAIL_CONFIG: ToolGuardrailConfig = {
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
};

/** Idempotent tools — safe to call repeatedly. */
export const IDEMPOTENT_TOOL_NAMES: ReadonlySet<string> = new Set([
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
  'plan_task',
]);

/** Mutating tools — repeated calls with same args may indicate a loop. */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'bash',
  'execute_code',
  'send_message',
]);

/** The type of guardrail action. */
export type GuardrailAction = 'allow' | 'warn' | 'halt' | 'inject_result';

/** The decision returned by the guardrail controller. */
export interface ToolGuardrailDecision {
  /** The action to take. */
  action: GuardrailAction;
  /** The reason for the action. */
  reason: string;
  /** The type of loop detected. */
  loopType?: 'exact_failure' | 'same_tool_failure' | 'no_progress' | 'none';
  /** The count that triggered the action. */
  count: number;
  /** The threshold that was exceeded. */
  threshold: number;
  /** A synthetic result to inject (if action is 'inject_result'). */
  syntheticResult?: string;
}

/** A tracked tool call within the guardrail controller. */
interface TrackedCall {
  toolName: string;
  argsHash: string;
  success: boolean;
  timestamp: number;
}

/** Options for the ToolGuardrailController. */
export interface ToolGuardrailControllerOptions {
  /** Override the default config. */
  config?: Partial<ToolGuardrailConfig>;
}

/**
 * Per-turn tool-call loop guardrail controller.
 *
 * Tracks tool calls within a single turn and detects loops. Side-effect
 * free — returns decisions for the runtime to apply.
 *
 * @module agent/tool-guardrails
 */
export class ToolGuardrailController {
  private readonly config: ToolGuardrailConfig;
  private readonly calls: TrackedCall[] = [];
  private readonly exactFailureCounts = new Map<string, number>();
  private readonly sameToolFailureCounts = new Map<string, number>();
  private noProgressCount = 0;
  private lastWorkingTreeHash: string | null = null;

  constructor(opts: ToolGuardrailControllerOptions = {}) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...opts.config };
  }

  /**
   * Record a tool call and check for loops.
   *
   * @param toolCall - The tool call that was made.
   * @param success - Whether the tool call succeeded.
   * @param workingTreeHash - Optional hash of the working tree (for no-progress detection).
   * @returns The guardrail decision.
   */
  check(
    toolCall: ToolCall,
    success: boolean,
    workingTreeHash?: string,
  ): ToolGuardrailDecision {
    const argsHash = this.hashArgs(toolCall);
    const toolName = toolCall.name;

    // Record the call
    this.calls.push({
      toolName,
      argsHash,
      success,
      timestamp: Date.now(),
    });

    // ─── 1. Exact failure detection ────────────────────────────
    // Same tool + same args failing repeatedly
    const exactKey = `${toolName}:${argsHash}`;
    if (!success) {
      const count = (this.exactFailureCounts.get(exactKey) ?? 0) + 1;
      this.exactFailureCounts.set(exactKey, count);

      if (count >= this.config.exactFailureBlockAfter) {
        return this.decision(
          'halt',
          `Exact failure loop: ${toolName} with identical args failed ${count} times (block threshold: ${this.config.exactFailureBlockAfter}). Halting to prevent infinite retry.`,
          'exact_failure',
          count,
          this.config.exactFailureBlockAfter,
        );
      }

      if (count >= this.config.exactFailureWarnAfter) {
        return this.decision(
          'warn',
          `Exact failure warning: ${toolName} with identical args failed ${count} times (warn threshold: ${this.config.exactFailureWarnAfter}). Consider changing approach.`,
          'exact_failure',
          count,
          this.config.exactFailureWarnAfter,
        );
      }
    } else {
      // Reset exact failure count on success
      this.exactFailureCounts.delete(exactKey);
    }

    // ─── 2. Same-tool failure detection ────────────────────────
    // Same tool failing (possibly different args)
    if (!success) {
      const count = (this.sameToolFailureCounts.get(toolName) ?? 0) + 1;
      this.sameToolFailureCounts.set(toolName, count);

      if (count >= this.config.sameToolFailureHaltAfter) {
        return this.decision(
          'halt',
          `Same-tool failure loop: ${toolName} failed ${count} times (halt threshold: ${this.config.sameToolFailureHaltAfter}). Halting to prevent infinite retry.`,
          'same_tool_failure',
          count,
          this.config.sameToolFailureHaltAfter,
        );
      }

      if (count >= this.config.sameToolFailureWarnAfter) {
        return this.decision(
          'warn',
          `Same-tool failure warning: ${toolName} failed ${count} times (warn threshold: ${this.config.sameToolFailureWarnAfter}). Consider using a different approach.`,
          'same_tool_failure',
          count,
          this.config.sameToolFailureWarnAfter,
        );
      }
    } else {
      this.sameToolFailureCounts.delete(toolName);
    }

    // ─── 3. No-progress detection ──────────────────────────────
    // Tool calls that don't change the working tree
    if (workingTreeHash !== undefined) {
      if (workingTreeHash === this.lastWorkingTreeHash) {
        this.noProgressCount++;

        // Only count no-progress for mutating tools (idempotent tools
        // don't change the tree by design)
        if (MUTATING_TOOL_NAMES.has(toolName)) {
          if (this.noProgressCount >= this.config.noProgressBlockAfter) {
            return this.decision(
              'inject_result',
              `No-progress loop: ${this.noProgressCount} consecutive mutating tool calls with no working-tree change (block threshold: ${this.config.noProgressBlockAfter}). Injecting synthetic result to break the loop.`,
              'no_progress',
              this.noProgressCount,
              this.config.noProgressBlockAfter,
              `The previous ${this.noProgressCount} tool calls did not change the workspace. Stop repeating the same action and try a different approach.`,
            );
          }

          if (this.noProgressCount >= this.config.noProgressWarnAfter) {
            return this.decision(
              'warn',
              `No-progress warning: ${this.noProgressCount} consecutive mutating tool calls with no working-tree change (warn threshold: ${this.config.noProgressWarnAfter}).`,
              'no_progress',
              this.noProgressCount,
              this.config.noProgressWarnAfter,
            );
          }
        }
      } else {
        this.noProgressCount = 0;
      }
      this.lastWorkingTreeHash = workingTreeHash;
    }

    // ─── 4. Allow ──────────────────────────────────────────────
    return this.decision('allow', 'No loop detected', 'none', 0, 0);
  }

  /**
   * Get a summary of the current turn's guardrail state.
   */
  getSummary(): {
    totalCalls: number;
    exactFailures: Array<{ key: string; count: number }>;
    sameToolFailures: Array<{ tool: string; count: number }>;
    noProgressCount: number;
  } {
    return {
      totalCalls: this.calls.length,
      exactFailures: [...this.exactFailureCounts.entries()].map(([key, count]) => ({ key, count })),
      sameToolFailures: [...this.sameToolFailureCounts.entries()].map(([tool, count]) => ({ tool, count })),
      noProgressCount: this.noProgressCount,
    };
  }

  /**
   * Reset the controller for a new turn.
   */
  reset(): void {
    this.calls.length = 0;
    this.exactFailureCounts.clear();
    this.sameToolFailureCounts.clear();
    this.noProgressCount = 0;
    this.lastWorkingTreeHash = null;
  }

  /**
   * Get the config (for display).
   */
  getConfig(): ToolGuardrailConfig {
    return { ...this.config };
  }

  // ─── Internal methods ──────────────────────────────────────────

  /**
   * Hash the tool call arguments for comparison.
   *
   * If parsing failed (malformed JSON), use the raw `arguments` string so
   * that two malformed calls with different content don't collide on `{}`.
   * Otherwise the exact-failure detector would fire on every parse error,
   * masking the real issue (malformed tool-call JSON from the model).
   * @param toolCall
   */
  private hashArgs(toolCall: ToolCall): string {
    if (toolCall.parseError || !toolCall.argumentsParsed) {
      return `RAW:${toolCall.arguments}`;
    }
    const sorted = sortObjectKeys(toolCall.argumentsParsed);
    return JSON.stringify(sorted);
  }

  /**
   * Create a decision object.
   * @param action
   * @param reason
   * @param loopType
   * @param count
   * @param threshold
   * @param syntheticResult
   */
  private decision(
    action: GuardrailAction,
    reason: string,
    loopType: ToolGuardrailDecision['loopType'],
    count: number,
    threshold: number,
    syntheticResult?: string,
  ): ToolGuardrailDecision {
    return { action, reason, loopType, count, threshold, syntheticResult };
  }
}

/**
 * Check if a tool is idempotent (safe to call repeatedly).
 * @param toolName
 */
export function isIdempotentTool(toolName: string): boolean {
  return IDEMPOTENT_TOOL_NAMES.has(toolName);
}

/**
 * Check if a tool is mutating (changes state).
 * @param toolName
 */
export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOL_NAMES.has(toolName);
}
