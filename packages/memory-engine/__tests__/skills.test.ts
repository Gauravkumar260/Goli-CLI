/**
 * Unit tests for the skill accumulation system.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SkillArchiver } from '../src/skills/archive.js';
import { SkillCatalog } from '../src/skills/catalog.js';
import { SEED_SKILLS } from '../src/skills/index.js';
import { SkillLoader } from '../src/skills/loader.js';
import { SkillWriter } from '../src/skills/writer.js';

import type { TrajectoryEntry } from '../src/skills/types.js';

let skillsDir: string;

beforeEach(() => {
  skillsDir = mkdtempSync(join(tmpdir(), 'goli-skills-test-'));
});

afterEach(() => {
  rmSync(skillsDir, { recursive: true, force: true });
});

function makeTrajectory(overrides: Partial<TrajectoryEntry> = {}): TrajectoryEntry {
  return {
    task: 'Refactor the auth module to use JWT',
    steps: [
      { tool: 'read_file', args: { file_path: 'src/auth.ts' }, result: 'file contents', ok: true },
      { tool: 'grep', args: { pattern: 'session' }, result: 'found 5 matches', ok: true },
      { tool: 'edit_file', args: { file_path: 'src/auth.ts', old_string: 'session', new_string: 'jwt' }, result: 'edited', ok: true },
      { tool: 'bash', args: { command: 'npm test' }, result: 'all tests passed', ok: true },
      { tool: 'write_file', args: { file_path: 'src/auth.test.ts', content: 'tests' }, result: 'written', ok: true },
    ],
    ok: true,
    tokensUsed: 5000,
    durationMs: 30000,
    ...overrides,
  };
}

describe('SkillWriter', () => {
  it('creates a skill from a successful trajectory with 5+ tool calls', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    expect(skill).not.toBeNull();
    expect(skill!.metadata.name).toBeDefined();
    expect(skill!.metadata.description).toContain('Refactor');
    expect(skill!.metadata.author).toBe('agent');
    expect(skill!.metadata.version).toBe('1.0.0');
    expect(existsSync(join(skillsDir, skill!.metadata.name, 'SKILL.md'))).toBe(true);
  });

  it('does not create a skill for failed tasks', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory({ ok: false }));
    expect(skill).toBeNull();
  });

  it('does not create a skill for tasks with fewer than 5 tool calls', () => {
    const writer = new SkillWriter({ skillsDir, minToolCalls: 5 });
    const skill = writer.createSkill(makeTrajectory({ steps: makeTrajectory().steps.slice(0, 3) }));
    expect(skill).toBeNull();
  });

  it('increments version when improving an existing skill', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory());

    // Create again (improve)
    const improved = writer.createSkill(makeTrajectory());
    expect(improved).not.toBeNull();
    expect(improved!.metadata.version).toBe('1.0.1');
  });

  it('categorizes tasks correctly', () => {
    const writer = new SkillWriter({ skillsDir });

    const refactorSkill = writer.createSkill(makeTrajectory({ task: 'Refactor the parser module' }));
    expect(refactorSkill!.metadata.category).toBe('refactoring');

    const testSkill = writer.createSkill(makeTrajectory({ task: 'Write unit tests for the auth module' }));
    expect(testSkill!.metadata.category).toBe('testing');

    const debugSkill = writer.createSkill(makeTrajectory({ task: 'Fix the crash in the login flow' }));
    expect(debugSkill!.metadata.category).toBe('debugging');
  });

  it('extracts trigger keywords from the trajectory', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory({ task: 'Refactor authentication module' }));

    expect(skill).not.toBeNull();
    expect(skill!.metadata.trigger.length).toBeGreaterThan(0);
    // Should include key terms from the task
    expect(skill!.metadata.trigger.some((t) => t.includes('refactor') || t.includes('authentication'))).toBe(true);
  });

  it('writes the SKILL.md with YAML frontmatter', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    const content = readFileSync(join(skillsDir, skill!.metadata.name, 'SKILL.md'), 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('name:');
    expect(content).toContain('description:');
    expect(content).toContain('trigger:');
    expect(content).toContain('version:');
    expect(content).toContain('author:');
    expect(content).toContain('lastImproved:');
  });

  it('shouldCreateSkill checks threshold and success', () => {
    const writer = new SkillWriter({ skillsDir, minToolCalls: 5 });
    expect(writer.shouldCreateSkill(makeTrajectory())).toBe(true);
    expect(writer.shouldCreateSkill(makeTrajectory({ ok: false }))).toBe(false);
    expect(writer.shouldCreateSkill(makeTrajectory({ steps: [] }))).toBe(false);
  });
});

describe('SkillCatalog', () => {
  it('lists empty catalog when no skills exist', () => {
    const catalog = new SkillCatalog({ skillsDir });
    expect(catalog.list()).toEqual([]);
    expect(catalog.count).toBe(0);
  });

  it('lists skills after they are created', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));

    const catalog = new SkillCatalog({ skillsDir });
    expect(catalog.list()).toHaveLength(1);
    expect(catalog.count).toBe(1);
  });

  it('gets a skill by name', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));

    const catalog = new SkillCatalog({ skillsDir });
    const loaded = catalog.get(skill!.metadata.name);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.name).toBe(skill!.metadata.name);
    expect(loaded!.body.length).toBeGreaterThan(0);
  });

  it('searches skills by query', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));
    writer.createSkill(makeTrajectory({ task: 'Write tests for parser' }));

    const catalog = new SkillCatalog({ skillsDir });
    const results = catalog.search('auth');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toContain('auth');
  });

  it('findByTriggers matches keywords', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));

    const catalog = new SkillCatalog({ skillsDir });
    const results = catalog.findByTriggers(['refactor', 'auth']);
    expect(results.length).toBeGreaterThan(0);
  });

  it('deletes a skill', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    const catalog = new SkillCatalog({ skillsDir });
    expect(catalog.delete(skill!.metadata.name)).toBe(true);
    expect(catalog.count).toBe(0);
  });

  it('parses seed skills correctly', () => {
    // Write a seed skill manually
    const seedSkill = SEED_SKILLS[0]!;
    const skillDir = join(skillsDir, seedSkill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), seedSkill.content, 'utf-8');

    const catalog = new SkillCatalog({ skillsDir });
    const metadata = catalog.getMetadata(seedSkill.name);
    expect(metadata).not.toBeNull();
    expect(metadata!.name).toBe(seedSkill.name);
    expect(metadata!.author).toBe('human');
  });
});

describe('SkillLoader', () => {
  it('getL1Metadata returns all skill metadata', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));
    writer.createSkill(makeTrajectory({ task: 'Write tests for parser' }));

    const loader = new SkillLoader({ skillsDir });
    const metadata = loader.getL1Metadata();
    expect(metadata).toHaveLength(2);
  });

  it('formatL1ForPrompt produces a readable summary', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));

    const loader = new SkillLoader({ skillsDir });
    const formatted = loader.formatL1ForPrompt();
    expect(formatted).toContain('Available skills:');
    expect(formatted).toContain('refactor');
  });

  it('formatL1ForPrompt handles empty catalog', () => {
    const loader = new SkillLoader({ skillsDir });
    const formatted = loader.formatL1ForPrompt();
    expect(formatted).toContain('No skills available');
  });

  it('loadL2Instructions returns the full body', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    const loader = new SkillLoader({ skillsDir });
    const body = loader.loadL2Instructions(skill!.metadata.name);
    expect(body).not.toBeNull();
    expect(body!.length).toBeGreaterThan(0);
    expect(body).toContain('## Steps');
  });

  it('loadL2Instructions returns null for non-existent skill', () => {
    const loader = new SkillLoader({ skillsDir });
    expect(loader.loadL2Instructions('nonexistent')).toBeNull();
  });

  it('findMatchingSkills finds skills by keywords', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Refactor auth module' }));

    const loader = new SkillLoader({ skillsDir });
    const matches = loader.findMatchingSkills(['refactor']);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('getL1TokenEstimate returns ~100 tokens per skill', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory({ task: 'Task one' }));
    writer.createSkill(makeTrajectory({ task: 'Task two' }));

    const loader = new SkillLoader({ skillsDir });
    expect(loader.getL1TokenEstimate()).toBe(200); // 2 skills × 100 tokens
  });
});

describe('SkillArchiver', () => {
  it('archives skills older than 90 days', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    // Manually set lastImproved to 100 days ago
    const skillFile = join(skillsDir, skill!.metadata.name, 'SKILL.md');
    const content = readFileSync(skillFile, 'utf-8');
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const updated = content.replace(/lastImproved: "[^"]*"/, `lastImproved: "${oldDate}"`);
    writeFileSync(skillFile, updated, 'utf-8');

    const archiver = new SkillArchiver({ skillsDir });
    const count = archiver.archiveStale();
    expect(count).toBe(1);

    // Verify it's archived
    const catalog = new SkillCatalog({ skillsDir });
    const metadata = catalog.getMetadata(skill!.metadata.name);
    expect(metadata!.archived).toBe(true);

    // Archived skills are excluded from list()
    expect(catalog.list()).toHaveLength(0);
    // But included in listAll()
    expect(catalog.listAll()).toHaveLength(1);
  });

  it('does not archive recent skills', () => {
    const writer = new SkillWriter({ skillsDir });
    writer.createSkill(makeTrajectory());

    const archiver = new SkillArchiver({ skillsDir });
    const count = archiver.archiveStale();
    expect(count).toBe(0);
  });

  it('unarchives a skill', () => {
    const writer = new SkillWriter({ skillsDir });
    const skill = writer.createSkill(makeTrajectory());

    const archiver = new SkillArchiver({ skillsDir });
    archiver.archiveSkill(skill!.metadata.name);

    const catalog = new SkillCatalog({ skillsDir });
    expect(catalog.getMetadata(skill!.metadata.name)!.archived).toBe(true);

    archiver.unarchiveSkill(skill!.metadata.name);
    expect(catalog.getMetadata(skill!.metadata.name)!.archived).toBe(false);
  });
});

describe('SEED_SKILLS', () => {
  it('contains 5 seed skills', () => {
    expect(SEED_SKILLS).toHaveLength(5);
  });

  it('all seed skills have valid frontmatter', () => {
    for (const seed of SEED_SKILLS) {
      expect(seed.content).toContain('---');
      expect(seed.content).toContain('name:');
      expect(seed.content).toContain('description:');
      expect(seed.content).toContain('trigger:');
      expect(seed.content).toContain('version:');
      expect(seed.content).toContain('author: "human"');
    }
  });

  it('seed skills cover different categories', () => {
    const categories = SEED_SKILLS.map((s) => {
      const match = s.content.match(/category:\s*"([^"]+)"/);
      return match?.[1];
    });
    expect(categories).toContain('refactoring');
    expect(categories).toContain('testing');
    expect(categories).toContain('debugging');
    expect(categories).toContain('code-review');
    expect(categories).toContain('workflow');
  });
});
