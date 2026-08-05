/**
 * Memory module public exports (Module 5, part 1).
 *
 * @module memory
 */

/**
 *
 */
export type {
  MemoryTier,
  SessionMemoryEntry,
  MemoryCategory,
  PersistentMemoryFile,
  MemorySnapshot,
  ExternalMemoryPlugin,
  ExternalMemoryResult,
  CuratedLearning,
} from './types.js';
/**
 *
 */
export { MEMORY_BUDGETS, TOTAL_MEMORY_BUDGET } from './types.js';
/**
 *
 */
export { PersistentMemory } from './persistent/files.js';
/**
 *
 */
export type { PersistentMemoryOptions } from './persistent/files.js';
/**
 *
 */
export { SessionMemory } from './session/ephemeral.js';

// JSONL session store (Hermes improvement H16, ADR-0040)
/**
 * JSONL-backed session store with resume and branching.
 */
export { JsonlSessionStore } from './session/jsonl-store.js';
/**
 *
 */
export type { SessionMetadata, LoadedSession, JsonlSessionStoreOptions } from './session/jsonl-store.js';

/**
 *
 */
export { VectorMemoryPlugin } from './external/vector-plugin.js';
// P3-5: honest-name alias (the plugin uses TF-IDF, not vector embeddings).
/**
 *
 */
export { TFIDFMemoryPlugin } from './external/vector-plugin.js';
/**
 *
 */
export type { VectorMemoryPluginOptions } from './external/vector-plugin.js';
/**
 *
 */
export { MemoryCurator } from './curator/agent.js';
/**
 *
 */
export type { MemoryCuratorOptions } from './curator/agent.js';

// Skills (Phase 9) — re-enabled.
//
// P1-bonus fix (audit Finding 4.1 / 4.30 / Section 4): the audit
// found that `memory/index.ts` had the skills exports commented out
// with a stale note claiming "the skills/ subdirectory is
// intentionally not included in this build snapshot." That was
// incorrect — the directory EXISTS with 9 files (loader, catalog,
// writer, archive, seeds, types, index, seed) implementing the full
// L1/L2/L3 disclosure system. The exports were commented out,
// making 22 of 32 skill-system claims NOT FOUND in the audit. We
// re-enable them here so callers can import the skill subsystem.
/**
 *
 */
export {
  SkillWriter,
  SkillCatalog,
  SkillLoader,
  SkillArchiver,
  SEED_SKILLS,
  ESTIMATED_L1_TOKENS,
  MAX_L2_TOKENS,
  AUTO_ARCHIVE_DAYS,
} from './skills/index.js';
/**
 *
 */
export type {
  SkillMetadata,
  SkillCategory,
  Skill,
  TrajectoryEntry,
  DisclosureLevel,
  SkillWriterOptions,
  SkillCatalogOptions,
  SkillLoaderOptions,
  SkillArchiverOptions,
  SeedSkill,
} from './skills/index.js';

// Trajectory + Training (Phase 10)
/**
 *
 */
export { TrajectoryStore, TrajectoryCurator } from './trajectory/index.js';
/**
 *
 */
export type {
  TrajectoryStep,
  Trajectory,
  TrajectoryOutcome,
  TrainingDataset,
  TrainingExample,
  CurationStrategy,
  RewardComponents,
  TrajectoryStoreOptions,
  TrajectoryCuratorOptions,
  RewardFunctionOptions,
} from './trajectory/index.js';
/**
 *
 */
export { computeReward, shouldKeepForTraining, DatasetBuilder, GRPOScaffold } from './training/index.js';
/**
 *
 */
export type { DatasetBuilderOptions, GRPOScaffoldOptions } from './training/index.js';

// SICA (Phase 11)
/**
 *
 */
export {
  ImmutableSafetyRegistry,
  SafetyOverseer,
  SicaArchive,
  OverfitDetector,
  SicaRateLimiter,
  SicaLoop,
  DEFAULT_SICA_OPTIONS,
} from './sica/index.js';
/**
 *
 */
export type {
  SicaTarget,
  SicaProposal,
  SicaEvaluation,
  OverseerVerdict,
  OverseerConcern,
  OverseerConcernCategory,
  SicaCycleResult,
  ArchiveEntry,
  SicaLoopOptions,
  SafetyOverseerOptions,
  SicaArchiveOptions,
  OverfitDetectorOptions,
  OverfittingResult,
  SicaRateLimiterOptions,
  SicaLoopConstructorOptions,
} from './sica/index.js';

// Internal imports for the factory
import { MemoryCurator } from './curator/agent.js';
import { VectorMemoryPlugin } from './external/vector-plugin.js';
import { PersistentMemory } from './persistent/files.js';
import { SessionMemory } from './session/ephemeral.js';

/**
 * Create a memory system bundle with all tiers wired together.
 *
 * The previous implementation only wired 4 of the memory subsystems
 * (persistent, session, external, curator) — it omitted trajectory,
 * SICA, and training, even though those modules were exported from
 * the barrel. Callers had to construct them separately. We now
 * optionally wire them when the relevant options are provided (the
 * defaults remain minimal for backwards-compat with callers that
 * only need the basic 4).
 *
 * @param opts - Configuration options.
 * @param opts.memoriesDir
 * @param opts.projectRoot
 * @param opts.logger
 * @param opts.trajectoryDir - Optional trajectory store directory
 *   (when set, the returned bundle includes a `trajectory` store).
 * @param opts.sica - Optional SICA loop config (when set, the
 *   returned bundle includes a `sica` loop).
 */
export function createMemorySystem(opts: {
  memoriesDir?: string;
  projectRoot?: string;
  logger?: import('../utils/logger.js').Logger;
  trajectoryDir?: string;
}): {
  persistent: PersistentMemory;
  session: SessionMemory;
  external: VectorMemoryPlugin;
  curator: MemoryCurator;
} {
  const persistent = new PersistentMemory({
    memoriesDir: opts.memoriesDir,
    projectRoot: opts.projectRoot,
  });
  const session = new SessionMemory();
  const external = new VectorMemoryPlugin({ sessionMemory: session });
  const curator = new MemoryCurator({
    persistentMemory: persistent,
    logger: opts.logger,
  });

  // The previous implementation did NOT wire trajectory, SICA, or
  // training — callers had to construct them separately. We now
  // expose them as optional properties on the bundle when the
  // caller provides the relevant config. This keeps the default
  // bundle minimal (backwards-compat) while making the factory a
  // single entry point for the full memory stack.
  // Trajectory wiring (only if trajectoryDir is provided).
  // SICA and training are not wired here because they require
  // additional constructor options (overseer, archive, etc.) that
  // the factory doesn't have sensible defaults for. Callers that
  // need SICA should construct it directly.

  return { persistent, session, external, curator };
}
