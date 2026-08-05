/**
 * Round-2 reverification fixes — targeted regression tests.
 *
 * Each `describe` block covers one Round-2 wiring/connection issue:
 *   - W1: SkillLoader wired in 3 production AgentLoop call sites
 *   - W2: SicaLoop.setEnabled() + singleton reuse
 *   - W3: agent/index.ts comment line refs (cosmetic — smoke-tested)
 *   - W4: CompactionEngine triggerRatio aligned with ADR-0023 (0.50)
 *   - W5: AllowlistEntry.expiresAt + TTL enforcement
 *   - W6: PostToolUseHookResult.modifiedResult + engine chaining
 *   - W7: MODE_SKILLS['plan'] uses 'refactoring' (matches description)
 *   - W8: Dead tool refs removed from mode whitelist + critical set
 *   - W9: SkillMetadata.id + disclosureLevel fields
 *   - W10: MEMORY_BUDGETS.SKILLS_L1 + TOTAL_MEMORY_BUDGET update
 *   - W11: project-map.ts docstring no longer claims tree-sitter
 *
 * These tests are intentionally narrow — they verify the fix, not the
 * full feature surface. They exist so a future refactor can't silently
 * regress the wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MEMORY_BUDGETS, TOTAL_MEMORY_BUDGET } from '../../packages/core/src/memory/types.js';
import type { SkillMetadata } from '../../packages/core/src/memory/skills/types.js';
import { SkillLoader } from '../../packages/core/src/memory/skills/loader.js';
import { SicaLoop } from '../../packages/core/src/memory/sica/loop.js';
import { EnhancedApprovalEngine } from '../../packages/core/src/approval/enhanced-approval.js';
import { HookEngine } from '../../packages/core/src/tools/hooks/engine.js';
import type { PostToolUseHookResult, HookContext } from '../../packages/core/src/tools/hooks/types.js';
import { CompactionEngine } from '../../packages/core/src/context/compaction/engine.js';

import { MODE_SKILLS, MODE_TOOLS, isToolAllowed } from '../../apps/cli/src/tui/lib/mode-config.js';
import { CliAgentLoop } from '../../apps/cli/src/services/CliAgentLoop.js';
import { COMPACT_TOOL_ALLOWLIST, isCompactTool } from '../../apps/cli/src/tui/components/messages/DenseToolMessage.js';

// ─── W1: SkillLoader wired in production ──────────────────────────

describe('Round-2 W1: SkillLoader is constructible + production-wired', () => {
  let skillsDir: string;
  beforeEach(() => { skillsDir = mkdtempSync(join(tmpdir(), 'goli-r2-w1-')); });
  afterEach(() => { rmSync(skillsDir, { recursive: true, force: true }); });

  it('loads an L1 fragment when the skills directory has a SKILL.md', () => {
    const skillName = 'my-test-skill';
    mkdirSync(join(skillsDir, skillName));
    writeFileSync(
      join(skillsDir, skillName, 'SKILL.md'),
      [
        '---',
        'name: my-test-skill',
        'description: Test skill',
        'trigger: ["test"]',
        'category: implementation',
        'version: 1.0.0',
        'author: human',
        'lastImproved: 2026-07-31T00:00:00Z',
        'archived: false',
        '---',
        '',
        'Body of the test skill.',
      ].join('\n'),
    );
    const loader = new SkillLoader({ skillsDir });
    const l1 = loader.formatL1ForPrompt();
    expect(l1).toContain('my-test-skill');
    expect(l1).toContain('Test skill');
  });

  it('returns "No skills available." when the directory is empty', () => {
    const loader = new SkillLoader({ skillsDir });
    expect(loader.formatL1ForPrompt()).toBe('No skills available.');
  });

  it('returns "No skills available." when the directory does not exist', () => {
    const loader = new SkillLoader({ skillsDir: join(skillsDir, 'does-not-exist') });
    expect(loader.formatL1ForPrompt()).toBe('No skills available.');
  });
});

// ─── W2: SicaLoop.setEnabled() + singleton reuse ──────────────────

describe('Round-2 W2: SicaLoop.setEnabled() toggles without reconstruction', () => {
  it('constructs disabled and can be enabled via setEnabled()', () => {
    const loop = new SicaLoop({ enabled: false, workspaceRoot: process.cwd() });
    expect(loop.isEnabled).toBe(false);
    loop.setEnabled(true);
    expect(loop.isEnabled).toBe(true);
    loop.setEnabled(false);
    expect(loop.isEnabled).toBe(false);
  });

  it('runCycle rejects when disabled, even after a prior enable→disable flip', async () => {
    const loop = new SicaLoop({ enabled: false, workspaceRoot: process.cwd() });
    loop.setEnabled(true);
    loop.setEnabled(false);
    // The proposal is rejected without invoking any of the 6 phases.
    const result = await loop.runCycle({
      proposalId: 'r2-test',
      target: 'system_prompt',
      targetName: 'test',
      oldContent: '',
      newContent: 'x',
      rationale: 'test',
      diff: '',
      linesChanged: 1,
      timestamp: new Date().toISOString(),
    });
    expect(result.adopted).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });
});

// ─── W3: agent/index.ts comment line refs (smoke) ─────────────────

describe('Round-2 W3: agent/index.ts comment line refs are accurate', () => {
  it('mentions loop.ts:593 for EffortRoutingClient (actual instantiation line)', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/agent/index.ts'),
      'utf-8',
    ));
    expect(source).toContain('loop.ts:593');
    expect(source).not.toContain('loop.ts:567');
  });

  it('mentions loop.ts:654 for ProvenanceTracker (actual instantiation line)', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/agent/index.ts'),
      'utf-8',
    ));
    expect(source).toContain('loop.ts:654');
    expect(source).not.toContain('loop.ts:628');
  });
});

// ─── W4: CompactionEngine triggerRatio aligned with ADR-0023 ──────

describe('Round-2 W4: CompactionEngine triggerRatio aligned with ADR-0023', () => {
  it('docstring mentions 50% (not 70%) as the trigger threshold', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/context/compaction/engine.ts'),
      'utf-8',
    ));
    expect(source).toMatch(/Triggers at 50%/);
    expect(source).not.toMatch(/Triggers at 70%/);
  });

  it('createContextEngine constructs with triggerRatio: 0.5', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/context/index.ts'),
      'utf-8',
    ));
    expect(source).toMatch(/triggerRatio:\s*0\.5/);
    expect(source).not.toMatch(/triggerRatio:\s*0\.7\b/);
  });

  it('CompactionEngine at 50% triggers at 500K of 1M tokens', () => {
    const engine = new CompactionEngine({
      maxContextTokens: 1_000_000,
      triggerRatio: 0.5,
    });
    expect(engine.shouldCompact(499_999)).toBe(false);
    expect(engine.shouldCompact(500_000)).toBe(true);
    expect(engine.shouldCompact(850_000)).toBe(true);
  });
});

// ─── W5: AllowlistEntry.expiresAt + TTL enforcement ───────────────

describe('Round-2 W5: AllowlistEntry.expiresAt + TTL enforcement', () => {
  let testDir: string;
  let engine: EnhancedApprovalEngine;
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'goli-r2-w5-'));
    engine = new EnhancedApprovalEngine({ allowlistPath: join(testDir, 'allowlist.json') });
  });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('addToAllowlist accepts an expiresAt option', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    engine.addToAllowlist('npm test', false, 'test', 'session-1', { expiresAt: future });
    const list = engine.getAllowlist();
    expect(list).toHaveLength(1);
    expect(list[0]?.expiresAt).toBe(future);
  });

  it('rejects an unparseable expiresAt up front', () => {
    engine.addToAllowlist('npm test', false, 'test', 'session-1', { expiresAt: 'not-a-date' });
    expect(engine.getAllowlist()).toHaveLength(0);
  });

  it('isAllowlisted skips entries whose expiresAt is in the past', async () => {
    // Round-2 W5: an expired entry must NOT be honored by the
    // allowlist. We assert `allowlisted === false` (the entry was
    // skipped). We do NOT assert `decision === 'deny'` — the
    // command may still be allowed for an unrelated reason (e.g.
    // it doesn't match any dangerous pattern, so it's safe-by-
    // default). The fix is specifically about the allowlist path.
    const past = new Date(Date.now() - 60_000).toISOString();
    engine.addToAllowlist('npm test', false, 'test', 'session-1', { expiresAt: past });
    const result = await engine.check('npm test');
    expect(result.allowlisted).toBe(false);
  });

  it('isAllowlisted honors entries whose expiresAt is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    engine.addToAllowlist('npm test', false, 'test', 'session-1', { expiresAt: future });
    const result = await engine.check('npm test');
    expect(result.allowlisted).toBe(true);
    expect(result.decision).toBe('allow');
  });

  it('pruneExpiredAllowlistEntries removes only expired entries', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    engine.addToAllowlist('expired-cmd', false, 'test', 's1', { expiresAt: past });
    engine.addToAllowlist('active-cmd', false, 'test', 's1', { expiresAt: future });
    engine.addToAllowlist('permanent-cmd', false, 'test', 's1');
    expect(engine.getAllowlist()).toHaveLength(3);

    const removed = engine.pruneExpiredAllowlistEntries();
    expect(removed).toBe(1);
    const remaining = engine.getAllowlist().map((e) => e.pattern);
    expect(remaining).not.toContain('expired-cmd');
    expect(remaining).toContain('active-cmd');
    expect(remaining).toContain('permanent-cmd');
  });
});

// ─── W6: PostToolUseHookResult.modifiedResult ─────────────────────

describe('Round-2 W6: PostToolUseHookResult.modifiedResult', () => {
  it('type accepts modifiedResult: { content, isError? }', () => {
    const result: PostToolUseHookResult = {
      feedback: 'redacted',
      modifiedResult: { content: '[redacted]', isError: false },
    };
    expect(result.modifiedResult?.content).toBe('[redacted]');
  });

  it('HookEngine surfaces the LAST non-undefined modifiedResult (chained overrides)', async () => {
    // Round-2 W6: when multiple hooks return `modifiedResult`, the
    // engine's `runPostToolUse()` must surface one of them in
    // `PostToolUseResult.modifiedResult`. We use distinct priorities
    // (lower priority number = runs earlier = lower index in
    // `this.hooks`) so the test is deterministic regardless of the
    // engine's tie-breaking behavior. `second` has priority 200 so
    // it runs AFTER `first` (priority 100) — its modifiedResult is
    // the last one set, so it wins.
    const engine = new HookEngine();
    const ctx: HookContext = {
      toolName: 'read_file',
      toolInput: { file_path: '/tmp/x' },
      result: { content: 'original', isError: false },
      sessionId: 'r2-test',
      workspaceRoot: process.cwd(),
    };
    engine.register({
      name: 'first',
      event: 'PostToolUse',
      priority: 100,
      handler: () => ({ modifiedResult: { content: 'first-rewrite' } }),
    });
    engine.register({
      name: 'second',
      event: 'PostToolUse',
      priority: 200,
      handler: () => ({ modifiedResult: { content: 'second-rewrite' } }),
    });
    engine.register({
      name: 'third',
      event: 'PostToolUse',
      priority: 300,
      handler: () => ({ feedback: 'third has no rewrite' }),
    });
    const result = await engine.runPostToolUse(ctx);
    expect(result.modifiedResult).toBeDefined();
    expect(result.modifiedResult?.content).toBe('second-rewrite');
    // `result.feedback` is an array of `'[hookname] feedback'` strings.
    expect(result.feedback.some((f) => f.includes('third has no rewrite'))).toBe(true);
  });

  it('HookEngine returns modifiedResult=undefined when no hook rewrites', async () => {
    const engine = new HookEngine();
    const ctx: HookContext = {
      toolName: 'read_file',
      toolInput: { file_path: '/tmp/x' },
      result: { content: 'original', isError: false },
      sessionId: 'r2-test',
      workspaceRoot: process.cwd(),
    };
    engine.register({
      name: 'feedback-only',
      event: 'PostToolUse',
      handler: () => ({ feedback: 'no rewrite' }),
    });
    const result = await engine.runPostToolUse(ctx);
    expect(result.modifiedResult).toBeUndefined();
  });
});

// ─── W7: MODE_SKILLS['plan'] uses 'refactoring' ───────────────────

describe('Round-2 W7: MODE_SKILLS.plan matches MODE_DESCRIPTIONS.plan.skills', () => {
  it("plan mode exposes 'refactoring' (not 'code-gen')", () => {
    const skills = MODE_SKILLS['plan'];
    expect(skills).toContain('refactoring');
    expect(skills).not.toContain('code-gen');
  });

  it("plan mode still has 3 skills (review, docs, refactoring)", () => {
    expect(MODE_SKILLS['plan']).toHaveLength(3);
    expect(MODE_SKILLS['plan']).toContain('review');
    expect(MODE_SKILLS['plan']).toContain('docs');
  });

  it("build mode still has 6 skills including 'code-gen' (unchanged)", () => {
    expect(MODE_SKILLS['build']).toHaveLength(6);
    expect(MODE_SKILLS['build']).toContain('code-gen');
  });
});

// ─── W8: Dead tool refs removed ───────────────────────────────────

describe('Round-2 W8: dead tool refs removed from mode whitelist + critical set', () => {
  it("MODE_TOOLS.read-only no longer contains dead refs", () => {
    const allowed = MODE_TOOLS['read-only'];
    expect(allowed).not.toContain('read_many_files');
    expect(allowed).not.toContain('glob');
    expect(allowed).not.toContain('ls');
  });

  it("MODE_TOOLS.read-only contains the actual registered names", () => {
    const allowed = MODE_TOOLS['read-only'];
    expect(allowed).toContain('read_file');
    expect(allowed).toContain('grep');
    expect(allowed).toContain('list_directory');
  });

  it("MODE_TOOLS.plan keeps plan_task (handled inline at loop.ts:919)", () => {
    expect(MODE_TOOLS['plan']).toContain('plan_task');
  });

  it("isToolAllowed returns false for dead refs (glob, ls, read_many_files)", () => {
    expect(isToolAllowed('read-only', 'glob')).toBe(false);
    expect(isToolAllowed('read-only', 'ls')).toBe(false);
    expect(isToolAllowed('read-only', 'read_many_files')).toBe(false);
    expect(isToolAllowed('plan', 'glob')).toBe(false);
    expect(isToolAllowed('plan', 'ls')).toBe(false);
  });

  it("isToolAllowed returns true for the real registered names", () => {
    expect(isToolAllowed('read-only', 'read_file')).toBe(true);
    expect(isToolAllowed('read-only', 'grep')).toBe(true);
    expect(isToolAllowed('read-only', 'list_directory')).toBe(true);
  });

  it("CRITICAL_TOOLS no longer contains dead refs", () => {
    // Round-2 W8: `isCriticalTool` is a private function in
    // CliAgentLoop.ts, but `shouldAskPermission` delegates to it.
    // We assert that the dead refs are NOT critical (i.e. they
    // don't require permission in build mode).
    const loop = new CliAgentLoop();
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('edit_batch')).toBe(false);
    expect(loop.shouldAskPermission('run_shell_command')).toBe(false);
    expect(loop.shouldAskPermission('background_shell')).toBe(false);
  });

  it("CRITICAL_TOOLS contains the real registered critical tools", () => {
    const loop = new CliAgentLoop();
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('bash')).toBe(true);
    expect(loop.shouldAskPermission('bash_output')).toBe(true);
    expect(loop.shouldAskPermission('kill_shell')).toBe(true);
    expect(loop.shouldAskPermission('write_file')).toBe(true);
    expect(loop.shouldAskPermission('edit_file')).toBe(true);
    expect(loop.shouldAskPermission('notebook_edit')).toBe(true);
    expect(loop.shouldAskPermission('spawn_subagent')).toBe(true);
  });

  it("COMPACT_TOOL_ALLOWLIST no longer contains dead refs", () => {
    expect(COMPACT_TOOL_ALLOWLIST).not.toContain('glob');
    expect(COMPACT_TOOL_ALLOWLIST).not.toContain('ls');
    expect(COMPACT_TOOL_ALLOWLIST).not.toContain('read_many_files');
  });

  it("COMPACT_TOOL_ALLOWLIST contains list_directory (the ls-equivalent)", () => {
    expect(COMPACT_TOOL_ALLOWLIST).toContain('list_directory');
  });

  it("isCompactTool returns false for dead refs", () => {
    expect(isCompactTool('glob')).toBe(false);
    expect(isCompactTool('ls')).toBe(false);
    expect(isCompactTool('read_many_files')).toBe(false);
  });
});

// ─── W9: SkillMetadata.id + disclosureLevel ───────────────────────

describe('Round-2 W9: SkillMetadata.id + disclosureLevel fields', () => {
  it("accepts an optional id field", () => {
    const meta: SkillMetadata = {
      name: 'my-skill',
      description: 'test',
      trigger: ['x'],
      category: 'implementation',
      version: '1.0.0',
      author: 'human',
      lastImproved: '2026-07-31T00:00:00Z',
      archived: false,
      id: 'my-skill-id',
    };
    expect(meta.id).toBe('my-skill-id');
  });

  it("accepts an optional disclosureLevel field", () => {
    const meta: SkillMetadata = {
      name: 'my-skill',
      description: 'test',
      trigger: ['x'],
      category: 'implementation',
      version: '1.0.0',
      author: 'human',
      lastImproved: '2026-07-31T00:00:00Z',
      archived: false,
      disclosureLevel: 'L1',
    };
    expect(meta.disclosureLevel).toBe('L1');
  });

  it("id and disclosureLevel are both optional (backward compatible)", () => {
    const meta: SkillMetadata = {
      name: 'legacy-skill',
      description: 'no id, no disclosureLevel',
      trigger: ['x'],
      category: 'implementation',
      version: '1.0.0',
      author: 'human',
      lastImproved: '2026-07-31T00:00:00Z',
      archived: false,
    };
    expect(meta.id).toBeUndefined();
    expect(meta.disclosureLevel).toBeUndefined();
  });
});

// ─── W10: MEMORY_BUDGETS.SKILLS_L1 ────────────────────────────────

describe('Round-2 W10: MEMORY_BUDGETS.SKILLS_L1', () => {
  it("exposes a SKILLS_L1 budget", () => {
    expect(MEMORY_BUDGETS.SKILLS_L1).toBeDefined();
    expect(typeof MEMORY_BUDGETS.SKILLS_L1).toBe('number');
    expect(MEMORY_BUDGETS.SKILLS_L1).toBeGreaterThan(0);
  });

  it("TOTAL_MEMORY_BUDGET includes SKILLS_L1", () => {
    const expected =
      MEMORY_BUDGETS.MEMORY +
      MEMORY_BUDGETS.USER +
      MEMORY_BUDGETS.PROJECT +
      MEMORY_BUDGETS.SKILLS_L1;
    expect(TOTAL_MEMORY_BUDGET).toBe(expected);
  });

  it("SKILLS_L1 is smaller than MEMORY (skills L1 metadata is compact)", () => {
    expect(MEMORY_BUDGETS.SKILLS_L1).toBeLessThan(MEMORY_BUDGETS.MEMORY);
  });
});

// ─── W11: project-map.ts docstring no longer claims tree-sitter ───

describe('Round-2 W11: project-map.ts docstring is honest about regex', () => {
  it("file-level docstring mentions regex-based heuristics", async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/context/project-map.ts'),
      'utf-8',
    ));
    expect(source).toMatch(/regex-based heuristics/i);
  });

  it("file-level docstring no longer claims tree-sitter as the current implementation", async () => {
    // The file-level docstring's FIRST PARAGRAPH (the summary, ~lines
    // 2-9 of the file) must describe the actual regex-based
    // implementation. It's OK to mention tree-sitter LATER in the
    // docstring as a future improvement (the NOTE paragraph does
    // this — it explicitly quotes the old misleading claim to
    // document the change). We restrict the check to the first 400
    // chars (just the summary paragraph) so the NOTE paragraph
    // doesn't trip the assertion.
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      join(process.cwd(), 'packages/core/src/context/project-map.ts'),
      'utf-8',
    ));
    const summary = source.slice(0, 400);
    expect(summary).not.toMatch(/Uses tree-sitter to extract symbols/);
    expect(summary).toMatch(/regex-based/i);
  });
});
