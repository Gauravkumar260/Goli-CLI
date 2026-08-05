/**
 * FrozenSnapshot (ADR-0024) — P3-1 fix (audit Finding 2.3).
 *
 * A FrozenSnapshot captures the agent's task context at session start
 * and re-injects it after every compaction so the agent never loses
 * sight of the original goal, role, and critical constraints.
 *
 * ## The problem
 *
 * When the context window fills up, the compressor summarizes the
 * middle of the conversation. The summary captures *what happened*
 * but can lose *why* — the original task prompt, the user's
 * constraints, the agent's role. After 3–4 compactions, the agent
 * may drift from the original goal (the "amnesia" problem documented
 * in ADR-0024).
 *
 * ## The fix
 *
 * At session start, we snapshot:
 *   - The original user prompt (task)
 *   - The agent role
 *   - The system-prompt identity fragment (mission statement)
 *   - Critical constraints extracted from the prompt (heuristic)
 *
 * After every compaction, the Freeze layer prepends the snapshot to
 * the summary so the agent sees:
 *
 *   [FROZEN SNAPSHOT — REFERENCE ONLY]
 *   Task: <original prompt>
 *   Role: <agent role>
 *   Mission: <identity fragment>
 *   Constraints: <extracted constraints>
 *   [END FROZEN SNAPSHOT]
 *
 *   [CONTEXT COMPACTION — REFERENCE ONLY]
 *   <summary>
 *   [END CONTEXT COMPACTION]
 *
 * The snapshot is immutable for the session — it's set once at
 * construction and never modified.
 *
 * @module agent/frozen-snapshot
 */

import type { AgentRole } from './types.js';

/**
 * A frozen snapshot of the task context, re-injected after every compaction.
 */
export interface FrozenSnapshot {
  /** The original user prompt (task). */
  taskPrompt: string;
  /** The agent role. */
  role: AgentRole;
  /** The system-prompt identity fragment (mission statement). */
  identityFragment: string;
  /** Critical constraints extracted from the prompt (heuristic). */
  constraints: string[];
  /** ISO timestamp of when the snapshot was taken. */
  createdAt: string;
}

/** Prefix marker for the frozen snapshot in the summary. */
export const FROZEN_SNAPSHOT_PREFIX = '[FROZEN SNAPSHOT — REFERENCE ONLY]';
/** Suffix marker for the frozen snapshot. */
export const FROZEN_SNAPSHOT_END_MARKER = '[END FROZEN SNAPSHOT]';

/**
 * Create a FrozenSnapshot from a task prompt + role + identity fragment.
 *
 * The constraints are extracted heuristically — we look for sentences
 * containing constraint keywords ("must", "should", "cannot", "don't",
 * "only", "never", "always"). This is a best-effort extraction; the
 * LLM can always re-derive constraints from the task prompt itself
 * (which is included verbatim in the snapshot).
 *
 * @param taskPrompt - The original user prompt.
 * @param role - The agent role.
 * @param identityFragment - The system-prompt identity fragment.
 * @returns A FrozenSnapshot.
 */
export function createFrozenSnapshot(
  taskPrompt: string,
  role: AgentRole,
  identityFragment: string,
): FrozenSnapshot {
  const constraints = extractConstraints(taskPrompt);
  return {
    taskPrompt,
    role,
    identityFragment,
    constraints,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Heuristically extract constraint sentences from a task prompt.
 *
 * Looks for sentences containing constraint keywords. Returns at most
 * 10 constraints to avoid flooding the snapshot.
 */
function extractConstraints(prompt: string): string[] {
  const keywords = /\b(must|should|cannot|can't|don't|do not|only|never|always|need to|needs to|required|mandatory|forbidden)\b/i;
  // Split into sentences (naive — split on . ! ? followed by space/newline).
  const sentences = prompt.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const constraints: string[] = [];
  for (const sentence of sentences) {
    if (keywords.test(sentence)) {
      constraints.push(sentence.trim());
      if (constraints.length >= 10) break;
    }
  }
  return constraints;
}

/**
 * Render a FrozenSnapshot as a string for injection into the summary.
 *
 * The output is wrapped in `FROZEN_SNAPSHOT_PREFIX` / `FROZEN_SNAPSHOT_END_MARKER`
 * so the agent can distinguish it from regular context.
 *
 * @param snapshot - The snapshot to render.
 * @returns The rendered string, or empty string if the snapshot is null.
 */
export function renderFrozenSnapshot(snapshot: FrozenSnapshot | null | undefined): string {
  if (!snapshot) return '';
  const lines: string[] = [
    FROZEN_SNAPSHOT_PREFIX,
    `Task: ${snapshot.taskPrompt}`,
    `Role: ${snapshot.role}`,
    `Mission: ${snapshot.identityFragment.slice(0, 500)}`,
  ];
  if (snapshot.constraints.length > 0) {
    lines.push('Constraints:');
    for (const c of snapshot.constraints) {
      lines.push(`  - ${c}`);
    }
  }
  lines.push(`(Snapshot taken: ${snapshot.createdAt})`);
  lines.push(FROZEN_SNAPSHOT_END_MARKER);
  return lines.join('\n');
}
