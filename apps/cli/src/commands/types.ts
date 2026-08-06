/**
 * Shared types and helpers for CLI command handlers.
 *
 * Every command handler receives a {@link CommandContext} and returns a
 * process exit code (0 = success, non-zero = failure). The context
 * carries the global flags parsed by Commander (--debug, --model, --god,
 * --auto, --sandbox, --effort) so each command can honor them.
 *
 * @module commands/types
 */

import type { AppConfig } from '@goli-cli/config';

/** Global options parsed from the top-level Commander program. */
export interface GlobalOptions {
  debug?: boolean;
  model?: string;
  god?: boolean;
  auto?: boolean;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  effort?: 'low' | 'high' | 'max';
  localLlms?: boolean;
}

/**
 * Extract global options from Commander's `program.opts()`.
 * Commander stores them as camelCase on the program object.
 * @param opts
 */
export function extractGlobalOptions(opts: Record<string, unknown>): GlobalOptions {
  return {
    debug: opts.debug as boolean | undefined,
    model: opts.model as string | undefined,
    god: opts.god as boolean | undefined,
    auto: opts.auto as boolean | undefined,
    sandbox: opts.sandbox as GlobalOptions['sandbox'],
    effort: opts.effort as GlobalOptions['effort'],
    localLlms: opts.localLlms as boolean | undefined,
  };
}

/** Context passed to every command handler. */
export interface CommandContext {
  /** The global options (from --debug, --model, --god, --auto, etc.). */
  globalOptions: GlobalOptions;
  /** The loaded and validated AppConfig (from TOML + env). */
  config: AppConfig;
  /** Whether --god mode is active (bypasses ALL safety gates). */
  godMode: boolean;
  /** Whether --auto mode is active (auto-approve Tier 2 / Risky actions). */
  autoMode: boolean;
}

/**
 * Build a CommandContext from global options + loaded config.
 *
 * Commands call this at the top of their handler to get a unified
 * context object.
 * @param globalOptions
 * @param config
 */
export function buildCommandContext(globalOptions: GlobalOptions, config: AppConfig): CommandContext {
  return {
    globalOptions,
    config,
    godMode: globalOptions.god ?? false,
    autoMode: globalOptions.auto ?? false,
  };
}
