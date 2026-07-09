/**
 * Application-wide constants.
 *
 * Single source of truth for the product name, version, and other
 * compile-time constants. Bumped here and propagated via the build.
 */

/**
 * The public product name. Deliberately avoids any vendor mark (no "GLM",
 * "Z.ai", "Claude", "Codex", "Cursor", "Gemini") — see ADR-0005.
 */
export const APP_NAME = 'goli-cli';

/**
 * The user-facing CLI binary name.
 */
export const CLI_BINARY_NAME = 'goli';

/**
 * The current released version. Follows semver; pre-1.0 we use phase
 * suffixes (`0.1.0-phase1`, `0.2.0-phase2`, …) until the Phase 13 GA.
 *
 * This is also exposed via the TUI HeaderBar (Phase 3).
 */
export const APP_VERSION = '0.2.0-phase2';

/**
 * The user-facing tagline shown by `goli --version` and the TUI splash.
 */
export const APP_TAGLINE = 'Multi-Agent Software Swarm';

/**
 * The default home directory for runtime state (crash snapshots, logs,
 * heap dumps, key bindings, persistent memory). Override via `GOLI_HOME`
 * env var. Mirrors the TUI reference design's contract.
 */
export const DEFAULT_GOLI_HOME_DIRNAME = '.goli-cli';

/**
 * The default model identifier.
 */
export const DEFAULT_MODEL_ID = 'default';

/**
 * The default reasoning effort. Phase 2 will route between `high` (routine)
 * and `max` (planning/refactor/architecture) per the Module 1 spec.
 */
export const DEFAULT_REASONING_EFFORT = 'high' as const;

/**
 * The default context window size for GLM-5.2 (1M tokens). Used by the
 * compaction trigger (70% of 1M = ~700K tokens) in Module 2.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * The compaction trigger threshold (70% of context window).
 * See Module 2 spec for the rationale (90% leaves only ~100K free, which
 * is too tight given 15-20K compaction overhead).
 */
export const COMPACTION_TRIGGER_RATIO = 0.7;

/**
 * The MIT license identifier used in SBOM and package metadata.
 */
export const LICENSE_SPDX = 'MIT';

/**
 * The SPDX license identifier for the model backend (GLM-5.2 weights).
 */
export const MODEL_LICENSE_SPDX = 'MIT';
