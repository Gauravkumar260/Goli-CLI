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

// Skills (Phase 9)
/**
 *
 */
export {
  SkillWriter,
  SkillCatalog,
  SkillLoader,
  SkillArchiver,
  SEED_SKILLS,
  AUTO_ARCHIVE_DAYS,
  MAX_L2_TOKENS,
  ESTIMATED_L1_TOKENS,
} from './skills/index.js';
/**
 *
 */
export type {
  SkillMetadata,
  SkillCategory,
  Skill,
  TrajectoryEntry,
  SkillWriterOptions,
  SkillCatalogOptions,
  SkillLoaderOptions,
  DisclosureLevel,
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
 * @param opts - Configuration options.
 * @param opts.memoriesDir
 * @param opts.projectRoot
 * @param opts.logger
 */
export function createMemorySystem(opts: {
  memoriesDir?: string;
  projectRoot?: string;
  logger?: import('../utils/logger.js').Logger;
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

  return { persistent, session, external, curator };
}
