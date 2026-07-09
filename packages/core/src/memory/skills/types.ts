/**
 * Skill accumulation type definitions (Phase 9, part 1).
 *
 * A "skill" is a reusable, self-written pattern extracted from a successful
 * agent trajectory. Skills use the Agent Skills spec: YAML frontmatter +
 * Markdown body + optional `scripts/`, `references/`, `assets/` subdirs.
 *
 * Skills follow a 3-level progressive disclosure model:
 *   - L1: ~100 tokens — frontmatter only (loaded at startup)
 *   - L2: <5K tokens   — full instructions (loaded on trigger)
 *   - L3: unlimited    — deep references (loaded on demand)
 *
 * @module skills/types
 */

/**
 * Skill category. Drives organization in the catalog and the
 * prompt-time grouping shown to the model.
 */
export type SkillCategory =
  | 'refactoring'
  | 'testing'
  | 'debugging'
  | 'code-review'
  | 'workflow'
  | 'documentation'
  | 'performance'
  | 'security'
  | 'deployment'
  | 'general';

/**
 * Disclosure level for progressive loading.
 *   - L1: frontmatter only (~100 tokens)
 *   - L2: full instructions (<5K tokens)
 *   - L3: deep references (unlimited)
 */
export type DisclosureLevel = 'L1' | 'L2' | 'L3';

/**
 * A single step in a trajectory (one tool invocation + its result).
 */
export interface TrajectoryStep {
  /** Tool name (e.g. `read_file`, `bash`). */
  tool: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Tool result (string or structured). */
  result: unknown;
  /** Whether the tool call succeeded. */
  ok: boolean;
}

/**
 * A captured trajectory of one task's tool-call sequence.
 * Used as input to {@link SkillWriter.createSkill}.
 */
export interface TrajectoryEntry {
  /** Human-readable task description. */
  task: string;
  /** Ordered list of tool-call steps. */
  steps: TrajectoryStep[];
  /** Whether the overall task succeeded. */
  ok: boolean;
  /** Total tokens consumed. */
  tokensUsed: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/**
 * Metadata for a skill — the L1 disclosure level.
 * Serialized as YAML frontmatter in SKILL.md.
 */
export interface SkillMetadata {
  /** Skill name (kebab-case, unique within the catalog). */
  name: string;
  /** One-line description (<=120 chars). */
  description: string;
  /** Category for grouping. */
  category: SkillCategory;
  /** Trigger keywords for matching. */
  trigger: string[];
  /** Semver version string. */
  version: string;
  /** Author: `agent` (auto-written) or `human` (seed). */
  author: 'agent' | 'human';
  /** ISO-8601 timestamp of last improvement. */
  lastImproved: string;
  /** Whether the skill is archived (excluded from L1). */
  archived?: boolean;
}

/**
 * A skill: metadata (L1) + body (L2 instructions).
 */
export interface Skill {
  /** L1 metadata. */
  metadata: SkillMetadata;
  /** L2 instructions (Markdown body). */
  body: string;
}

/**
 * Options for {@link SkillWriter}.
 */
export interface SkillWriterOptions {
  /** Directory where skills are stored (one subdir per skill). */
  skillsDir: string;
  /** Minimum tool calls in a trajectory to write a skill. Default 5. */
  minToolCalls?: number;
}

/**
 * Options for {@link SkillCatalog}.
 */
export interface SkillCatalogOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
}

/**
 * Options for {@link SkillLoader}.
 */
export interface SkillLoaderOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
}

/**
 * Options for {@link SkillArchiver}.
 */
export interface SkillArchiverOptions {
  /** Directory where skills are stored. */
  skillsDir: string;
  /** Days of inactivity before archiving. Default 90. */
  staleDays?: number;
}

/**
 * A seed skill shipped with Goli-CLI (name + raw SKILL.md content).
 */
export interface SeedSkill {
  /** Skill name (kebab-case). */
  name: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
}
