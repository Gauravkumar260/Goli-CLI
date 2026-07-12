/**
 * lib/mode-config.ts — Mode→Agent→Skill→Prompt configuration (T-MODE-WIRE).
 *
 * Each of the 4 modes (read-only, plan, build, god) has:
 *   - A set of active agents (which agents can be dispatched)
 *   - A set of available skills (which skills can be used)
 *   - A mode-specific system prompt fragment
 *   - A set of allowed tool categories (which tool types are permitted)
 *
 * This module is the single source of truth for mode behavior. The
 * AgentLoop, ToolRegistry, and SystemPromptAssembler all read from here.
 *
 * @module lib/mode-config
 */

import type { AppMode } from '../theme/agents.js';

// ─── Mode→Agent mapping ─────────────────────────────────────────────

/** Agents active in each mode. */
export const MODE_AGENTS: Record<AppMode, readonly string[]> = {
  'read-only': ['orchestrator', 'searcher', 'reviewer'],
  'plan':      ['orchestrator', 'searcher', 'reviewer', 'designer'],
  'build':     ['orchestrator', 'coder', 'reviewer', 'searcher', 'devops', 'designer', 'security', 'data'],
  'god':       ['orchestrator', 'coder', 'reviewer', 'searcher', 'devops', 'designer', 'security', 'data'],
};

/**
 * Get the agents active in a given mode.
 */
export function getAgentsForMode(mode: AppMode): readonly string[] {
  return MODE_AGENTS[mode] ?? MODE_AGENTS['build'];
}

/**
 * Check if an agent is active in the given mode.
 */
export function isAgentActive(mode: AppMode, agentId: string): boolean {
  return getAgentsForMode(mode).includes(agentId);
}

// ─── Mode→Skill mapping ─────────────────────────────────────────────

/** Skills available in each mode. */
export const MODE_SKILLS: Record<AppMode, readonly string[]> = {
  'read-only': ['review', 'docs'],
  'plan':      ['review', 'docs', 'code-gen'],
  'build':     ['code-gen', 'refactor', 'test-gen', 'debug', 'review', 'docs'],
  'god':       ['code-gen', 'refactor', 'test-gen', 'debug', 'review', 'docs'],
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
export { MODE_PROMPTS, getPromptForMode } from '@goli/core';  // re-exported from config barrel

// ─── Mode→Tool category mapping ─────────────────────────────────────

/** Tool categories allowed in each mode. */
export const MODE_TOOLS: Record<AppMode, readonly string[]> = {
  'read-only': ['read_file', 'read_many_files', 'grep', 'glob', 'ls', 'web_search', 'web_fetch'],
  'plan':      ['read_file', 'read_many_files', 'grep', 'glob', 'ls', 'web_search', 'web_fetch', 'plan_task'],
  'build':     ['*'], // all tools
  'god':       ['*'], // all tools, no gates
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

/** Human-readable mode descriptions for UI display. */
export const MODE_DESCRIPTIONS: Record<AppMode, { short: string; long: string; agents: string; skills: string }> = {
  'read-only': {
    short: 'read-only, no writes',
    long: 'Read files, search code, and analyze. No writes, edits, or command execution.',
    agents: 'orchestrator, searcher, reviewer',
    skills: 'review, docs',
  },
  'plan': {
    short: 'plan mode, no edits',
    long: 'Read and analyze to create a detailed plan. No edits or command execution.',
    agents: 'orchestrator, searcher, reviewer, designer',
    skills: 'review, docs, code-gen',
  },
  'build': {
    short: 'full permissions (default)',
    long: 'Full permissions to read, write, and execute within the workspace.',
    agents: 'all 8 agents',
    skills: 'all 6 skills',
  },
  'god': {
    short: 'maximum autonomy, bypass all gates',
    long: 'All safety gates bypassed. Maximum autonomy. Use with extreme caution.',
    agents: 'all 8 agents',
    skills: 'all 6 skills',
  },
};

/**
 * Get the full mode description for display.
 */
export function getModeDescription(mode: AppMode): { short: string; long: string; agents: string; skills: string } {
  return MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['build'];
}
