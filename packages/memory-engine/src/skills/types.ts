/**
 * Skills system types (Phase 9, ADR-0026).
 *
 * A "skill" is a reusable, self-written playbook extracted from a
 * successful agent trajectory. Skills follow a 3-level progressive
 * disclosure model:
 *
 *   L1 — metadata (~100 tokens/skill): loaded at session start so the
 *        agent knows what skills exist and when to trigger them.
 *   L2 — full instructions (<5K tokens): loaded on-demand when a skill
 *        is triggered, injected into the system prompt.
 *   L3 — deep reference: optional, loaded via a tool call when the
 *        agent needs exhaustive detail.
 *
 * Skills are stored as `SKILL.md` files with YAML frontmatter, one
 * directory per skill:
 *
 *   <skillsDir>/<skill-name>/SKILL.md
 *
 * P1-15 fix (remediation plan Phase 15): `SkillCategory` and
 * `SkillMetadata` now have Zod schemas (`SkillCategorySchema`,
 * `SkillMetadataSchema`) for runtime validation of YAML frontmatter
 * on skill load. The TS types are kept as the canonical compile-time
 * contract; the Zod schemas mirror them for runtime checks.
 *
 * @module memory/skills/types
 */

import { z } from 'zod';

/**
 * P1-15: Zod schema for `SkillCategory`. Used by `SkillCatalog` to
 * validate the `category` field in YAML frontmatter on skill load.
 * Throws a structured error when the value isn't one of the 7
 * supported categories, instead of silently accepting garbage.
 */
export const SkillCategorySchema = z.enum([
  'refactoring',
  'testing',
  'debugging',
  'code-review',
  'workflow',
  'implementation',
  'documentation',
]);

/**
 * The category of a skill. Used by the mode system to filter which
 * skills are available in each mode (e.g. `read-only` mode only
 * exposes `code-review` and `docs` skills).
 *
 * Inferred from `SkillCategorySchema` so the TS type and the Zod
 * schema can never drift apart.
 */
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

/**
 * P1-15: Zod schema for `DisclosureLevel`. Used by `SkillCatalog`
 * to validate the `disclosureLevel` field when present.
 */
export const DisclosureLevelSchema = z.enum(['L1', 'L2', 'L3']);

/**
 * The disclosure level for progressive disclosure (ADR-0026).
 *
 *   L1 — metadata only (~100 tokens/skill)
 *   L2 — full instructions (<5K tokens)
 *   L3 — deep reference (on-demand via tool call)
 */
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;

/**
 * P1-15: Zod schema for `SkillMetadata`. Mirrors the TS interface
 * field-for-field. Used by `SkillCatalog` to validate YAML
 * frontmatter on skill load — invalid skills are rejected with a
 * structured error instead of silently producing a malformed
 * `SkillMetadata` object.
 *
 * `id` and `disclosureLevel` are optional (matching the TS interface);
 * the catalog fills in defaults after validation.
 */
export const SkillMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  trigger: z.array(z.string()).default([]),
  category: SkillCategorySchema,
  version: z.string().min(1),
  author: z.enum(['human', 'agent']),
  lastImproved: z.string(),
  archived: z.boolean().default(false),
  disclosureLevel: DisclosureLevelSchema.optional(),
});

/**
 * Metadata for a skill, parsed from the YAML frontmatter of `SKILL.md`.
 *
 * Round-2 verification item #5: previously missing `id` and
 * `disclosureLevel`. The `id` is optional (derived from `name` if
 * not set) so existing skill files without it continue to work; the
 * `disclosureLevel` is optional (defaults to `'L1'` in the catalog)
 * so the progressive-disclosure API has a stable per-skill hint.
 * `trigger` keeps its singular name for backwards compatibility with
 * existing SKILL.md frontmatter and the SkillWriter output format.
 */
export interface SkillMetadata {
  /** Optional stable ID (kebab-case). If omitted, `name` is used as the ID. */
  id?: string;
  /** Skill name (kebab-case, unique within the catalog). */
  name: string;
  /** One-line description of what the skill does. */
  description: string;
  /** Keywords that trigger the skill (matched against the user's prompt). */
  trigger: string[];
  /** Semantic category — used by the mode system to filter skills. */
  category: SkillCategory;
  /** Skill version (semver). Incremented on each improvement. */
  version: string;
  /** Who authored the skill: `"human"` for seed skills, `"agent"` for self-written. */
  author: 'human' | 'agent';
  /** ISO timestamp of the last improvement. */
  lastImproved: string;
  /** Whether the skill has been archived (auto-archive after 90 days unused). */
  archived: boolean;
  /**
   * Optional disclosure level hint (ADR-0026). Defaults to `'L1'` in
   * the catalog. L1 = metadata only, L2 = full instructions, L3 =
   * deep reference (on-demand via tool call).
   */
  disclosureLevel?: DisclosureLevel;
}

/**
 * A skill = metadata + body (the Markdown instructions).
 */
export interface Skill {
  metadata: SkillMetadata;
  body: string;
}

/**
 * A single step in a trajectory — used by `SkillWriter` to extract
 * a playbook from a successful agent run.
 */
export interface TrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
}

/**
 * A completed agent trajectory. The `SkillWriter` examines this to
 * decide whether a skill should be created.
 */
export interface TrajectoryEntry {
  task: string;
  steps: TrajectoryStep[];
  ok: boolean;
  tokensUsed: number;
  durationMs: number;
}

/** Options for {@link SkillWriter}. */
export interface SkillWriterOptions {
  /** Directory where skills are stored (one subdirectory per skill). */
  skillsDir: string;
  /** Minimum number of tool calls in a trajectory to be worth saving. Default: 5. */
  minToolCalls?: number;
}

/** Options for {@link SkillCatalog}. */
export interface SkillCatalogOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
}

/** Options for {@link SkillLoader}. */
export interface SkillLoaderOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
}

/** Options for {@link SkillArchiver}. */
export interface SkillArchiverOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
  /** Archive threshold in days. Default: 90. */
  archiveAfterDays?: number;
}

/**
 * A seed skill (shipped with the project, authored by humans).
 * Used to bootstrap the skill catalog on first run.
 */
export interface SeedSkill {
  name: string;
  content: string;
}
