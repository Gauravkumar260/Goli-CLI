/**
 * SICA module public exports (Module 5, part 4).
 *
 * @module memory/sica
 */

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
} from './types.js';
/**
 *
 */
export { DEFAULT_SICA_OPTIONS } from './types.js';
/**
 *
 */
export { ImmutableSafetyRegistry } from './immutable-registry.js';
/**
 *
 */
export { SafetyOverseer } from './overseer.js';
/**
 *
 */
export type { SafetyOverseerOptions } from './overseer.js';
/**
 *
 */
export { SicaArchive } from './archive.js';
/**
 *
 */
export type { SicaArchiveOptions } from './archive.js';
/**
 *
 */
export { OverfitDetector } from './overfit-detector.js';
/**
 *
 */
export type { OverfitDetectorOptions, OverfittingResult } from './overfit-detector.js';
/**
 *
 */
export { SicaRateLimiter } from './rate-limiter.js';
/**
 *
 */
export type { SicaRateLimiterOptions } from './rate-limiter.js';
/**
 *
 */
export { SicaLoop } from './loop.js';
/**
 *
 */
export type { SicaLoopConstructorOptions } from './loop.js';
