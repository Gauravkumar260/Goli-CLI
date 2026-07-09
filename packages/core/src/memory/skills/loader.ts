/**
 * Skill loader — 3-level progressive disclosure.
 *
 *   - L1: frontmatter only (~100 tokens per skill). Loaded at startup
 *         and injected into the system prompt.
 *   - L2: full instructions (<5K tokens). Loaded on trigger when a
 *         skill matches the current task.
 *   - L3: deep references (unlimited). Loaded on explicit demand.
 *
 * @module skills/loader
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SkillCatalog } from './catalog.js';

import type { SkillLoaderOptions, SkillMetadata } from './types.js';

/** Estimated tokens per skill at L1 (frontmatter only). */
export const ESTIMATED_L1_TOKENS_PER_SKILL = 100;

/** Maximum tokens for L2 instructions. */
export const MAX_L2_TOKENS = 5000;

/**
 * SkillLoader — progressive-disclosure reader.
 */
export class SkillLoader {
  private readonly skillsDir: string;
  private readonly catalog: SkillCatalog;

  constructor(opts: SkillLoaderOptions) {
    this.skillsDir = opts.skillsDir;
    this.catalog = new SkillCatalog({ skillsDir: this.skillsDir });
  }

  /** L1: metadata for all non-archived skills. */
  getL1Metadata(): SkillMetadata[] {
    return this.catalog.list();
  }

  /** L1: format the metadata as a prompt fragment. */
  formatL1ForPrompt(): string {
    const skills = this.getL1Metadata();
    if (skills.length === 0) {
      return 'No skills available.';
    }
    const lines: string[] = ['Available skills:'];
    for (const s of skills) {
      lines.push(`- ${s.name} (v${s.version}, ${s.category}): ${s.description}`);
    }
    return lines.join('\n');
  }

  /** L2: full instructions for a skill, or null if not found. */
  loadL2Instructions(name: string): string | null {
    const file = join(this.skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) return null;
    try {
      const content = readFileSync(file, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      return match?.[2] ?? content;
    } catch {
      return null;
    }
  }

  /** L3: deep references for a skill (files in `references/`). */
  loadL3References(name: string): string[] {
    const refsDir = join(this.skillsDir, name, 'references');
    if (!existsSync(refsDir)) return [];
    try {
      return readdirSync(refsDir)
        .filter((f: string) => f.endsWith('.md'))
        .map((f: string) => readFileSync(join(refsDir, f), 'utf-8'));
    } catch {
      return [];
    }
  }

  /** Find skills whose triggers match the given keywords. */
  findMatchingSkills(keywords: string[]): SkillMetadata[] {
    return this.catalog.findByTriggers(keywords);
  }

  /** Estimated L1 token cost (skills × 100). */
  getL1TokenEstimate(): number {
    return this.getL1Metadata().length * ESTIMATED_L1_TOKENS_PER_SKILL;
  }
}
