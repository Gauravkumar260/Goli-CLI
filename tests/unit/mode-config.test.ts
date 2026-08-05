/**
 * Tests for mode-config: mode→agent→skill→prompt wiring.
 *
 * Covers:
 *   - All 4 modes have agent mappings
 *   - read-only mode has 3 agents (orchestrator, searcher, reviewer)
 *   - plan mode has 4 agents (+ designer)
 *   - build mode has all 8 agents
 *   - god mode has all 8 agents
 *   - isAgentActive() checks correctly
 *   - All 4 modes have skill mappings
 *   - read-only mode has 2 skills (review, docs)
 *   - plan mode has 3 skills (+ code-gen)
 *   - build/god mode has all 6 skills
 *   - isSkillAvailable() checks correctly
 *   - All 4 modes have prompt mappings
 *   - getPromptForMode() returns non-empty strings
 *   - read-only prompt mentions READ-ONLY
 *   - plan prompt mentions PLAN mode
 *   - build prompt mentions BUILD mode
 *   - god prompt mentions GOD mode
 *   - Mode→tool mappings exist
 *   - isToolAllowed() works for read-only (blocks write_file)
 *   - isToolAllowed() works for build (allows all)
 *   - getModeDescription() returns full descriptions
 */

import { describe, it, expect } from 'vitest';

import {
  MODE_AGENTS,
  MODE_SKILLS,
  MODE_PROMPTS,
  MODE_TOOLS,
  MODE_DESCRIPTIONS,
  MODE_PRIMARY_AGENT,
  getAgentsForMode,
  getPrimaryAgentForMode,
  getSkillsForMode,
  getPromptForMode,
  getAllowedToolsForMode,
  isAgentActive,
  isSkillAvailable,
  isToolAllowed,
  getModeDescription,
} from '../../apps/cli/src/tui/lib/mode-config.js';

// ─── Mode→Agent mapping ─────────────────────────────────────────────

describe('Mode config: Mode→Agent mapping', () => {
  it('all 4 modes have agent mappings', () => {
    expect(MODE_AGENTS['read-only']).toBeDefined();
    expect(MODE_AGENTS['plan']).toBeDefined();
    expect(MODE_AGENTS['build']).toBeDefined();
    expect(MODE_AGENTS['god']).toBeDefined();
  });

  it('read-only mode has 4 agents (orchestrator, scout, researcher, reviewer)', () => {
    const agents = getAgentsForMode('read-only');
    expect(agents).toHaveLength(4);
    expect(agents).toContain('orchestrator');
    expect(agents).toContain('scout');
    expect(agents).toContain('researcher');
    expect(agents).toContain('reviewer');
  });

  it('plan mode has 6 agents (+ architect, planner)', () => {
    const agents = getAgentsForMode('plan');
    expect(agents).toHaveLength(6);
    expect(agents).toContain('orchestrator');
    expect(agents).toContain('scout');
    expect(agents).toContain('researcher');
    expect(agents).toContain('architect');
    expect(agents).toContain('planner');
    expect(agents).toContain('reviewer');
  });

  it('build mode has 9 agents (no scout/researcher — execution-focused)', () => {
    const agents = getAgentsForMode('build');
    expect(agents).toHaveLength(9);
    expect(agents).toContain('orchestrator');
    expect(agents).toContain('architect');
    expect(agents).toContain('planner');
    expect(agents).toContain('implementer');
    expect(agents).toContain('debugger');
    expect(agents).toContain('qa-tester');
    expect(agents).toContain('reviewer');
    expect(agents).toContain('security-auditor');
    expect(agents).toContain('documenter');
  });

  it('god mode has all 11 agents', () => {
    const agents = getAgentsForMode('god');
    expect(agents).toHaveLength(11);
  });

  it('read-only mode does NOT have implementer agent', () => {
    expect(isAgentActive('read-only', 'implementer')).toBe(false);
    expect(isAgentActive('read-only', 'debugger')).toBe(false);
  });

  it('build mode has implementer agent', () => {
    expect(isAgentActive('build', 'implementer')).toBe(true);
    expect(isAgentActive('build', 'debugger')).toBe(true);
  });

  it('isAgentActive returns false for unknown agent', () => {
    expect(isAgentActive('build', 'nonexistent')).toBe(false);
  });

  it('each mode has a primary agent for AgentLoop.run({ role })', () => {
    expect(getPrimaryAgentForMode('read-only')).toBe('reviewer');
    expect(getPrimaryAgentForMode('plan')).toBe('architect');
    expect(getPrimaryAgentForMode('build')).toBe('implementer');
    expect(getPrimaryAgentForMode('god')).toBe('orchestrator');
  });
});


// ─── Mode→Skill mapping ─────────────────────────────────────────────

describe('Mode config: Mode→Skill mapping', () => {
  it('all 4 modes have skill mappings', () => {
    expect(MODE_SKILLS['read-only']).toBeDefined();
    expect(MODE_SKILLS['plan']).toBeDefined();
    expect(MODE_SKILLS['build']).toBeDefined();
    expect(MODE_SKILLS['god']).toBeDefined();
  });

  it('read-only mode has 2 skills (review, docs)', () => {
    const skills = getSkillsForMode('read-only');
    expect(skills).toHaveLength(2);
    expect(skills).toContain('review');
    expect(skills).toContain('docs');
  });

  it('plan mode has 3 skills (+ refactoring)', () => {
    // Round-2 verification item #7: previously asserted `code-gen`,
    // but `MODE_DESCRIPTIONS.plan.skills` says `refactoring`. The
    // data and the description have been aligned to `refactoring`
    // (plan mode benefits from refactoring guidance, not code-gen).
    const skills = getSkillsForMode('plan');
    expect(skills).toHaveLength(3);
    expect(skills).toContain('review');
    expect(skills).toContain('docs');
    expect(skills).toContain('refactoring');
  });

  it('build mode has all 6 skills', () => {
    const skills = getSkillsForMode('build');
    expect(skills).toHaveLength(6);
    expect(skills).toContain('code-gen');
    expect(skills).toContain('refactor');
    expect(skills).toContain('test-gen');
    expect(skills).toContain('debug');
    expect(skills).toContain('review');
    expect(skills).toContain('docs');
  });

  it('god mode has all 6 skills', () => {
    const skills = getSkillsForMode('god');
    expect(skills).toHaveLength(6);
  });

  it('read-only mode does NOT have code-gen skill', () => {
    expect(isSkillAvailable('read-only', 'code-gen')).toBe(false);
    expect(isSkillAvailable('read-only', 'debug')).toBe(false);
  });

  it('build mode has all skills available', () => {
    expect(isSkillAvailable('build', 'code-gen')).toBe(true);
    expect(isSkillAvailable('build', 'debug')).toBe(true);
  });
});


// ─── Mode→Prompt mapping ────────────────────────────────────────────

describe('Mode config: Mode→Prompt mapping', () => {
  it('all 4 modes have prompt mappings', () => {
    expect(MODE_PROMPTS['read-only']).toBeDefined();
    expect(MODE_PROMPTS['plan']).toBeDefined();
    expect(MODE_PROMPTS['build']).toBeDefined();
    expect(MODE_PROMPTS['god']).toBeDefined();
  });

  it('all prompts are non-empty strings', () => {
    for (const prompt of Object.values(MODE_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(20);
    }
  });

  it('read-only prompt mentions READ-ONLY', () => {
    expect(getPromptForMode('read-only')).toContain('READ-ONLY');
  });

  it('plan prompt mentions PLAN mode', () => {
    expect(getPromptForMode('plan')).toContain('PLAN');
  });

  it('build prompt mentions BUILD mode', () => {
    expect(getPromptForMode('build')).toContain('BUILD');
  });

  it('god prompt mentions GOD mode', () => {
    expect(getPromptForMode('god')).toContain('GOD');
  });

  it('read-only prompt mentions cannot write', () => {
    expect(getPromptForMode('read-only').toLowerCase()).toContain('cannot');
  });

  it('plan prompt mentions plan_task tool', () => {
    expect(getPromptForMode('plan')).toContain('plan_task');
  });

  it('build prompt mentions full permissions', () => {
    expect(getPromptForMode('build').toLowerCase()).toContain('full');
  });

  it('god prompt mentions bypassed', () => {
    expect(getPromptForMode('god').toLowerCase()).toContain('bypass');
  });
});


// ─── Mode→Tool mapping ──────────────────────────────────────────────

describe('Mode config: Mode→Tool mapping', () => {
  it('all 4 modes have tool mappings', () => {
    expect(MODE_TOOLS['read-only']).toBeDefined();
    expect(MODE_TOOLS['plan']).toBeDefined();
    expect(MODE_TOOLS['build']).toBeDefined();
    expect(MODE_TOOLS['god']).toBeDefined();
  });

  it('read-only mode allows read_file', () => {
    expect(isToolAllowed('read-only', 'read_file')).toBe(true);
  });

  it('read-only mode blocks write_file', () => {
    expect(isToolAllowed('read-only', 'write_file')).toBe(false);
  });

  it('read-only mode blocks run_shell_command', () => {
    expect(isToolAllowed('read-only', 'run_shell_command')).toBe(false);
  });

  it('plan mode allows plan_task', () => {
    expect(isToolAllowed('plan', 'plan_task')).toBe(true);
  });

  it('plan mode blocks write_file', () => {
    expect(isToolAllowed('plan', 'write_file')).toBe(false);
  });

  it('build mode allows all tools', () => {
    expect(isToolAllowed('build', 'read_file')).toBe(true);
    expect(isToolAllowed('build', 'write_file')).toBe(true);
    expect(isToolAllowed('build', 'run_shell_command')).toBe(true);
  });

  it('god mode allows all tools', () => {
    expect(isToolAllowed('god', 'read_file')).toBe(true);
    expect(isToolAllowed('god', 'write_file')).toBe(true);
    expect(isToolAllowed('god', 'run_shell_command')).toBe(true);
  });
});


// ─── Mode descriptions ──────────────────────────────────────────────

describe('Mode config: Mode descriptions', () => {
  it('all 4 modes have descriptions', () => {
    expect(MODE_DESCRIPTIONS['read-only']).toBeDefined();
    expect(MODE_DESCRIPTIONS['plan']).toBeDefined();
    expect(MODE_DESCRIPTIONS['build']).toBeDefined();
    expect(MODE_DESCRIPTIONS['god']).toBeDefined();
  });

  it('getModeDescription returns short, long, agents, skills', () => {
    const desc = getModeDescription('build');
    expect(desc.short).toBeTruthy();
    expect(desc.long).toBeTruthy();
    expect(desc.agents).toBeTruthy();
    expect(desc.skills).toBeTruthy();
  });

  it('read-only description mentions read-only', () => {
    expect(getModeDescription('read-only').short).toContain('read-only');
  });

  it('god description mentions maximum autonomy', () => {
    expect(getModeDescription('god').short).toContain('maximum autonomy');
  });
});
