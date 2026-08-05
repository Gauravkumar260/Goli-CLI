/**
 * lib/mode-config.ts — Mode→Agent→Skill→Prompt configuration (T-MODE-WIRE).
 *
 * Each of the 4 modes (read-only, plan, build, god) has:
 *   - A set of active agents (which AgentRole specialists can be dispatched)
 *   - A primary specialist agent (the role passed to AgentLoop.run())
 *   - A set of available skills (which skill categories can be used)
 *   - A mode-specific system prompt fragment
 *   - A set of allowed tool categories (which tool types are permitted)
 *
 * This module is the single source of truth for mode behavior. The
 * AgentLoop, ToolRegistry, and SystemPromptAssembler all read from here.
 *
 * ## Vocabulary alignment
 *
 * The agent IDs below use the **core `AgentRole`** vocabulary (11 roles:
 * scout, researcher, architect, planner, implementer, debugger,
 * qa-tester, security-auditor, reviewer, orchestrator, documenter) — NOT
 * the TUI display vocabulary (8 agents: coder, searcher, devops,
 * designer, security, data, etc.). This ensures `MODE_AGENTS` can be
 * consumed directly by `AgentLoop.run({ role })` which expects an
 * `AgentRole`.
 *
 * @module lib/mode-config
 */

import type { AppMode } from '../theme/agents.js';
import type { AgentRole } from '@goli/core';

// ─── Mode→Agent mapping ─────────────────────────────────────────────

/**
 * Agents active in each mode. Uses the core `AgentRole` vocabulary so
 * the values can be passed directly to `AgentLoop.run({ role })`.
 */
export const MODE_AGENTS: Record<AppMode, readonly AgentRole[]> = {
  'read-only':  ['orchestrator', 'scout', 'researcher', 'reviewer'],
  'plan':       ['orchestrator', 'scout', 'researcher', 'architect', 'planner', 'reviewer'],
  'build':      ['orchestrator', 'architect', 'planner', 'implementer', 'debugger', 'qa-tester', 'reviewer', 'security-auditor', 'documenter'],
  'god':        ['orchestrator', 'scout', 'researcher', 'architect', 'planner', 'implementer', 'debugger', 'qa-tester', 'security-auditor', 'reviewer', 'documenter'],
  'local-llms': ['orchestrator', 'architect', 'planner', 'implementer', 'debugger', 'qa-tester', 'reviewer', 'security-auditor', 'documenter'],
};

/**
 * The primary specialist agent for each mode — the role that gets
 * passed to `AgentLoop.run({ role })` as the default. The TUI can
 * override per-task, but this is the "mode's agent".
 *
 *   read-only  → reviewer   (analysis + audit, no writes)
 *   plan       → architect  (design + decomposition)
 *   build      → implementer (write + edit + test)
 *   god        → orchestrator (full autonomy, coordinates all roles)
 */
export const MODE_PRIMARY_AGENT: Record<AppMode, AgentRole> = {
  'read-only':  'reviewer',
  'plan':       'architect',
  'build':      'implementer',
  'god':        'orchestrator',
  'local-llms': 'implementer',
};

/**
 * Get the agents active in a given mode.
 */
export function getAgentsForMode(mode: AppMode): readonly AgentRole[] {
  return MODE_AGENTS[mode] ?? MODE_AGENTS['build'];
}

/**
 * Get the primary specialist agent for a mode.
 */
export function getPrimaryAgentForMode(mode: AppMode): AgentRole {
  return MODE_PRIMARY_AGENT[mode] ?? 'implementer';
}

/**
 * Check if an agent is active in the given mode.
 */
export function isAgentActive(mode: AppMode, agentId: string): boolean {
  return getAgentsForMode(mode).includes(agentId as AgentRole);
}

// ─── Mode→Skill mapping ─────────────────────────────────────────────

/** Skills available in each mode. */
export const MODE_SKILLS: Record<AppMode, readonly string[]> = {
  'read-only':  ['review', 'docs'],
  // Round-2 verification item #7: previously `['review', 'docs',
  // 'code-gen']`, but `MODE_DESCRIPTIONS.plan.skills` at the bottom
  // of this file already said `'code-review, documentation,
  // refactoring'`. The data and the description disagreed. We now
  // align the data with the description: plan mode exposes
  // `refactoring` (read-and-plan mode benefits from refactoring
  // guidance, not from code-gen which is build mode's specialty).
  'plan':       ['review', 'docs', 'refactoring'],
  'build':      ['code-gen', 'refactor', 'test-gen', 'debug', 'review', 'docs'],
  'god':        ['code-gen', 'refactor', 'test-gen', 'debug', 'review', 'docs'],
  'local-llms': ['code-gen', 'refactor', 'test-gen', 'debug', 'review', 'docs'],
};

/**
 * Get the skills available in a given mode.
 */
export function getSkillsForMode(mode: AppMode): readonly string[] {
  return MODE_SKILLS[mode] ?? MODE_SKILLS['build'];
}

/**
 * Check if a skill is available in the given mode.
 */
export function isSkillAvailable(mode: AppMode, skillId: string): boolean {
  return getSkillsForMode(mode).includes(skillId);
}

// ─── Mode→Prompt mapping (single source: @goli/core/config) ─────────
/**
 *
 */
export { MODE_PROMPTS, getPromptForMode } from '@goli/core';  // re-exported from config barrel

// ─── Mode→Tool category mapping ─────────────────────────────────────

/** Tool categories allowed in each mode. */
export const MODE_TOOLS: Record<AppMode, readonly string[]> = {
  // P1-6 fix (verification report item #12): LSP tools (lsp_hover,
  // lsp_goto_definition, lsp_references, lsp_diagnostics) are T0
  // (Safe) read-only tools per ADR-0045, but were missing from the
  // read-only and plan mode whitelists. This meant `isToolAllowed('read-only', 'lsp_hover')`
  // returned false, so users in read-only/plan mode couldn't use
  // LSP-powered code navigation even though those tools perform no
  // writes. We now include all 4 LSP tools in both read-only and
  // plan mode (they're already T0 in the approval engine, so no
  // permission prompts are needed).
  // Round-2 verification item T1 (dead tool refs): the previous
  // whitelist included `read_many_files`, `glob`, and `ls` — none of
  // which are registered tool names. The actual registered tools are
  // `read_file`, `grep`, and `list_directory` (see
  // `tools/index.ts:createDefaultToolRegistry()`). The dead names
  // never matched anything (the LLM never returned them, since they
  // aren't in the tool definitions sent to the model), but they
  // created the false impression that those tools existed. We now
  // align the whitelist with the actual registry.
  //
  // `plan_task` is kept — although it isn't in the ToolRegistry, it
  // IS handled inline at `loop.ts:919` (passed as `PLAN_TASK_TOOL`
  // to the model) so the LLM may legitimately emit `plan_task` calls.
  'read-only':  ['read_file', 'grep', 'list_directory', 'web_search', 'web_fetch', 'lsp_hover', 'lsp_goto_definition', 'lsp_references', 'lsp_diagnostics'],
  'plan':       ['read_file', 'grep', 'list_directory', 'web_search', 'web_fetch', 'plan_task', 'lsp_hover', 'lsp_goto_definition', 'lsp_references', 'lsp_diagnostics'],
  'build':      ['*'], // all tools
  'god':        ['*'], // all tools, no gates
  'local-llms': ['*'], // all tools — router handles model selection, not tool gating
};

/**
 * Get the allowed tool names for a given mode.
 * Returns ['*'] if all tools are allowed.
 */
export function getAllowedToolsForMode(mode: AppMode): readonly string[] {
  return MODE_TOOLS[mode] ?? MODE_TOOLS['build'];
}

/**
 * Check if a tool is allowed in the given mode.
 */
export function isToolAllowed(mode: AppMode, toolName: string): boolean {
  const allowed = getAllowedToolsForMode(mode);
  if (allowed.includes('*')) return true;
  return allowed.includes(toolName);
}

// ─── Mode metadata ──────────────────────────────────────────────────

/**
 * P1-7 fix (audit Finding 6.3 / 3.14): Mode → sandbox policy mapping.
 *
 * The audit found that `bash.ts:99` hardcodes `approvalPolicy: 'on-request'`
 * regardless of the current AppMode, and that `SandboxMode` /
 * `ApprovalPolicy` were independent user config knobs with no mapping
 * from the mode. The brief describes:
 *
 *   read-only  → sandboxMode: 'read-only',     approvalPolicy: 'never'
 *   plan       → sandboxMode: 'read-only',     approvalPolicy: 'never'
 *   build      → sandboxMode: 'workspace-write', approvalPolicy: 'on-request'
 *   god        → sandboxMode: 'danger-full-access', approvalPolicy: 'never'
 *   local-llms → sandboxMode: 'workspace-write', approvalPolicy: 'on-request'
 *
 * This function is the single source of truth for that mapping. It's
 * called on mode switch (TUI) and on agent startup (headless) so the
 * sandbox + approval policy always reflect the active mode.
 *
 * Note: `bash.ts` still reads `ctx.sandboxMode` (set by AgentLoop from
 * `config.sandbox.mode`). The follow-up to fully wire this is to have
 * `CliAgentLoop.setAppMode()` call `config.sandbox.mode = ...` on mode
 * switch — for now, this function exposes the mapping so callers can
 * query and apply it.
 */
export interface ModeSandboxPolicy {
  /** The sandbox mode for this app mode. */
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** The approval policy for this app mode. */
  approvalPolicy: 'on-request' | 'on-failure' | 'never';
}

/**
 * Map an AppMode to its (sandboxMode, approvalPolicy) pair.
 * See {@link ModeSandboxPolicy} for the rationale.
 */
export function modeToSandboxPolicy(mode: AppMode): ModeSandboxPolicy {
  switch (mode) {
    case 'read-only':
      // Read-only: no writes, no commands. Approval is moot (T0 only).
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
    case 'plan':
      // Plan mode: read + analyze, no edits. Same sandbox as read-only
      // (the mode-config tool filter already blocks mutating tools).
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
    case 'build':
      // Build mode: writes + commands within workspace. Ask before
      // T1+ actions (this is what triggers the new pre-execution
      // approval gate in bash.ts / write_file.ts / etc.).
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' };
    case 'god':
      // God mode: full access, no approval. BLK commands are still
      // denied by the ApprovalEngine (separate from the policy).
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
    case 'local-llms':
      // Local-LLMs mode: same sandbox as build (the three-axis router
      // handles model selection, not tool gating).
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' };
    default:
      // Unknown mode — fail safe to the most restrictive.
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
  }
}

/** Human-readable mode descriptions for UI display. */
export const MODE_DESCRIPTIONS: Record<AppMode, { short: string; long: string; agents: string; skills: string; primaryAgent: AgentRole }> = {
  'read-only': {
    short: 'read-only, no writes',
    long: 'Read files, search code, and analyze. No writes, edits, or command execution. Specialist: Reviewer (analysis + audit).',
    agents: 'orchestrator, scout, researcher, reviewer',
    skills: 'code-review, documentation',
    primaryAgent: 'reviewer',
  },
  'plan': {
    short: 'plan mode, no edits',
    long: 'Read and analyze to create a detailed plan with tracked TODOs. No edits or command execution. Specialist: Architect (design + decomposition).',
    agents: 'orchestrator, scout, researcher, architect, planner, reviewer',
    skills: 'code-review, documentation, refactoring',
    primaryAgent: 'architect',
  },
  'build': {
    short: 'full permissions (default)',
    long: 'Full permissions to read, write, and execute within the workspace. Specialist: Implementer (write + edit + test).',
    agents: 'orchestrator, architect, planner, implementer, debugger, qa-tester, reviewer, security-auditor, documenter',
    skills: 'refactoring, testing, debugging, code-review, documentation, workflow',
    primaryAgent: 'implementer',
  },
  'god': {
    short: 'maximum autonomy, bypass all gates',
    long: 'All safety gates bypassed. Maximum autonomy. All 8 TUI agent roles available (the underlying AgentRole enum has 11 values; the TUI surfaces 8). Specialist: Orchestrator (full coordination).',
    agents: 'all 8 TUI agent roles',
    skills: 'all 6 skill categories',
    primaryAgent: 'orchestrator',
  },
  'local-llms': {
    short: 'three-axis local-LLM router (sensitivity/complexity/availability)',
    long: 'Build permissions + a three-axis router across local Ollama workers (qwen3.5:4b orchestrator, qwen2.5-coder:7b, qwen3:4b, gemma3:4b) and a cloud tier (gpt-oss:120b-cloud). PII/restricted prompts are hard-gated to local; complexity picks the worker; circuit breakers cascade on failure. Specialist: Implementer.',
    agents: 'orchestrator, architect, planner, implementer, debugger, qa-tester, reviewer, security-auditor, documenter',
    skills: 'code-gen, refactor, test-gen, debug, review, docs',
    primaryAgent: 'implementer',
  },
};

/**
 * Get the full mode description for display.
 */
export function getModeDescription(mode: AppMode): { short: string; long: string; agents: string; skills: string; primaryAgent: AgentRole } {
  return MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['build'];
}
