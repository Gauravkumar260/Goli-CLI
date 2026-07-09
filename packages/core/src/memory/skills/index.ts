/**
 * Skills module — public exports for Phase 9 (Skill Accumulation).
 *
 * Re-exports the writer, catalog, loader, archiver, seed skills,
 * and the L1/L2 token budget constants.
 *
 * @module skills
 */

/**
 *
 */
export { SkillWriter, DEFAULT_MIN_TOOL_CALLS, listSkillDirs } from './writer.js';
/**
 *
 */
export { SkillCatalog, parseFrontmatterString } from './catalog.js';
/**
 *
 */
export { SkillLoader, ESTIMATED_L1_TOKENS_PER_SKILL, MAX_L2_TOKENS } from './loader.js';
/**
 *
 */
export { SkillArchiver, AUTO_ARCHIVE_DAYS } from './archive.js';
/**
 *
 */
export { SEED_SKILLS } from './seed.js';

/**
 *
 */
export type {
  SkillCategory,
  DisclosureLevel,
  TrajectoryStep,
  TrajectoryEntry,
  SkillMetadata,
  Skill,
  SkillWriterOptions,
  SkillCatalogOptions,
  SkillLoaderOptions,
  SkillArchiverOptions,
  SeedSkill,
} from './types.js';

/**
 * Estimated L1 tokens per skill — exposed at the index level
 * for the prompt-builder to budget the L1 disclosure set.
 */
export const ESTIMATED_L1_TOKENS = 100;

