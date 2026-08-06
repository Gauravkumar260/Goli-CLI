/**
 * CLI-local constants.
 *
 * These mirror `@goli/core`'s `utils/constants.ts` but live in the CLI
 * package so that `goli --version` and `goli --help` don't pull in the
 * full `@goli/core` module graph (208 source files) just to read three
 * strings. Cold-start drops from ~218ms to <200ms (A1).
 *
 * Keep in sync with `packages/shared/src/utils/constants.ts`. If you add a
 * constant here that the CLI uses at module-load time, add it there too
 * (and vice versa for constants the CLI used to import from core).
 *
 * @module cli/constants
 */

/**
 * The public product name. Deliberately avoids any vendor mark.
 */
export const APP_NAME = 'goli-cli';

/**
 * The user-facing CLI binary name.
 */
export const CLI_BINARY_NAME = 'goli';

/**
 * The current released version. Follows semver; pre-1.0 we use phase
 * suffixes.
 */
export const APP_VERSION = '0.2.0-phase2';

/**
 * The user-facing tagline shown by `goli --version` and the TUI splash.
 */
export const APP_TAGLINE = 'Multi-Agent Software Swarm';
