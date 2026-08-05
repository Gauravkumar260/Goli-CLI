/**
 * SkillLoader — progressive disclosure of skill content (ADR-0026).
 *
 *   L1 — metadata (~100 tokens/skill): loaded at session start.
 *   L2 — full instructions (<5K tokens): loaded on-demand.
 *   L3 — deep reference: loaded via tool call (future).
 *
 * P1-16 fix (remediation plan Phase 16): the loader now supports
 * mode-based skill filtering (`listForMode()`) and L1 budget
 * enforcement with top-K ranking (`rankAndTruncateL1()`). When the
 * caller provides an `AppMode` and a `query`, the L1 metadata is
 * filtered to the categories allowed in that mode, ranked by trigger
 * relevance to the query, and truncated to fit within the L1 token
 * budget (default: `MEMORY_BUDGETS.SKILLS_L1` = 800 tokens ≈ 8 skills).
 *
 * @module memory/skills/loader
 */

import { SkillCatalog } from './catalog.js';

import type { SkillMetadata, SkillLoaderOptions, SkillCategory } from './types.js';

/** Estimated tokens per skill in L1 metadata format. */
export const ESTIMATED_L1_TOKENS = 100;

/** Maximum tokens for L2 instructions. */
export const MAX_L2_TOKENS = 5000;

/**
 * P1-16: Default L1 token budget. Mirrors `MEMORY_BUDGETS.SKILLS_L1`
 * from `memory/types.ts` (800) — duplicated here to avoid a circular
 * import (memory/types.ts → memory/index.ts → memory/skills/* → loader.ts).
 * If `MEMORY_BUDGETS.SKILLS_L1` changes, update this constant too.
 */
export const DEFAULT_L1_BUDGET_TOKENS = 800;

/**
 * P1-16: Mode → allowed skill categories mapping.
 *
 * The mapping reflects what each mode is allowed to do:
 *   - `read-only`: only review + docs (no mutations).
 *   - `plan`: review + docs + refactoring (planning refactors is
 *     safe; executing them isn't, but the plan output is just text).
 *   - `build` / `god` / `local-llms`: all categories (full access).
 *
 * Skills whose category isn't in the allowed set are filtered out
 * before L1 metadata is formatted — the model never sees them, so it
 * can't accidentally invoke a `debugging` skill in `read-only` mode.
 */
export const MODE_SKILL_CATEGORIES: Record<string, readonly SkillCategory[]> = {
  'read-only': ['code-review', 'documentation'],
  plan: ['code-review', 'documentation', 'refactoring'],
  build: ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'implementation'],
  god: ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'implementation'],
  'local-llms': ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'implementation'],
} as const;

/**
 * SkillLoader provides the progressive-disclosure API for skills.
 */
export class SkillLoader {
  private readonly catalog: SkillCatalog;

  constructor(opts: SkillLoaderOptions) {
    this.catalog = new SkillCatalog({ skillsDir: opts.skillsDir });
  }

  /** L1: return metadata for all active skills. */
  getL1Metadata(): SkillMetadata[] {
    return this.catalog.list().map((s) => s.metadata);
  }

  /**
   * P1-16: return metadata for skills allowed in the given `AppMode`.
   *
   * Falls back to `getL1Metadata()` (all skills) when `mode` is
   * unknown or undefined — backward-compatible with callers that
   * haven't been updated to pass a mode.
   */
  listForMode(mode: string | undefined): SkillMetadata[] {
    if (!mode) return this.getL1Metadata();
    const allowed = MODE_SKILL_CATEGORIES[mode];
    if (!allowed) return this.getL1Metadata();
    const allowedSet = new Set(allowed as readonly string[]);
    return this.getL1Metadata().filter((m) => allowedSet.has(m.category));
  }

  /**
   * P1-16: rank skills by trigger relevance to a query and truncate
   * to fit within a token budget.
   *
   * Ranking score = number of trigger keywords that appear in the
   * query (case-insensitive substring match). Skills with score 0
   * are kept but ranked last (so the user still sees the catalog
   * when the query doesn't match any triggers).
   *
   * Truncation: walks the ranked list, adding skills until the next
   * one would exceed `budgetTokens`. Each skill costs
   * `ESTIMATED_L1_TOKENS` (100) tokens. The result always includes
   * at least 1 skill (the top-ranked one) when the input is non-empty,
   * even if it exceeds the budget — better to show one relevant skill
   * than zero.
   *
   * @param skills - The skills to rank (typically the output of `listForMode()`).
   * @param query - The user's task prompt (used for trigger matching).
   * @param budgetTokens - Max tokens to spend on L1 metadata. Default: 800.
   */
  rankAndTruncateL1(
    skills: SkillMetadata[],
    query: string,
    budgetTokens: number = DEFAULT_L1_BUDGET_TOKENS,
  ): SkillMetadata[] {
    if (skills.length === 0) return [];
    const q = query.toLowerCase();
    const ranked = skills
      .map((skill) => ({
        skill,
        score: skill.trigger.filter((k) => q.includes(k.toLowerCase())).length,
      }))
      .sort((a, b) => b.score - a.score);

    const result: SkillMetadata[] = [];
    let tokens = 0;
    for (const { skill } of ranked) {
      if (result.length > 0 && tokens + ESTIMATED_L1_TOKENS > budgetTokens) {
        break;
      }
      result.push(skill);
      tokens += ESTIMATED_L1_TOKENS;
    }
    return result;
  }

  /**
   * L1: format the metadata as a prompt-friendly summary.
   * Returns "No skills available." if the catalog is empty.
   *
   * P1-16: now accepts optional `mode` and `query` for filtering +
   * ranking. When both are provided, the formatted output only
   * includes skills allowed in `mode`, ranked by relevance to
   * `query`, truncated to the L1 budget. When omitted, all skills
   * are included (backward-compatible with the original signature).
   */
  formatL1ForPrompt(opts?: { mode?: string; query?: string }): string {
    // P1-16: backward-compatible signature. The original method took
    // no arguments; we add an optional opts bag so existing callers
    // keep working.
    if (!opts || (opts.mode === undefined && opts.query === undefined)) {
      const metadata = this.getL1Metadata();
      if (metadata.length === 0) {
        return 'No skills available.';
      }
      const lines = ['Available skills:'];
      for (const m of metadata) {
        lines.push(`  - ${m.name} (${m.category}): ${m.description}`);
      }
      return lines.join('\n');
    }

    // P1-16: mode-filtered + ranked + truncated path.
    const modeSkills = this.listForMode(opts.mode);
    if (modeSkills.length === 0) {
      return 'No skills available.';
    }
    const ranked = this.rankAndTruncateL1(modeSkills, opts.query ?? '');
    if (ranked.length === 0) {
      return 'No skills available.';
    }
    const lines = ['Available skills:'];
    for (const m of ranked) {
      lines.push(`  - ${m.name} (${m.category}): ${m.description}`);
    }
    return lines.join('\n');
  }

  /** L2: load the full instructions for a skill. Returns null if not found. */
  loadL2Instructions(name: string): string | null {
    const skill = this.catalog.get(name);
    if (!skill) {
      return null;
    }
    return skill.body;
  }

  /** Find skills whose triggers match the provided keywords. */
  findMatchingSkills(keywords: string[]): SkillMetadata[] {
    return this.catalog.findByTriggers(keywords);
  }

  /** Estimate the token cost of L1 metadata (100 tokens per skill). */
  getL1TokenEstimate(): number {
    return this.getL1Metadata().length * ESTIMATED_L1_TOKENS;
  }
}
