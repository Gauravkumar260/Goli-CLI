/**
 * args.ts — Pure argument parsing for the goli CLI.
 *
 * Kept separate from cli.tsx so tests can import and exercise it
 * without booting Ink.
 */

/**
 *
 */
export interface ParsedArgs {
  showHelp: boolean;
  showVersion: boolean;
  isWakeup: boolean;
  /**
   * Positional arguments after the `wakeup` subcommand. `goli wakeup "refactor X"`
   * yields `initialTask: 'refactor X'`. Empty string when none provided.
   */
  initialTask: string;
  /** --recover : resume from last crash snapshot. */
  isRecover: boolean;
  /** --clear-crash : discard last crash snapshot and exit. */
  isClearCrash: boolean;
  /** --accessibility : screen-reader mode (no animations, no box-drawing). */
  accessibility: boolean;
  /** --debug : show debug overlay. */
  debug: boolean;
}

/**
 *
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  const showHelp = args.includes('--help') || args.includes('-h');
  const showVersion = args.includes('--version') || args.includes('-V');

  // `wakeup` is the legacy subcommand CliAgentLoop spawns. The
  // --json / -j / --interactive / -i flags are also accepted for
  // backwards compatibility. None of these change behavior today —
  // they all launch the same Ink TUI; only `wakeup` skips the splash.
  const isWakeup = args[0] === 'wakeup';

  // `goli wakeup "<task>"` — the legacy `run.ts` command spawns the TUI
  // this way for one-shot tasks. Treat everything after the first
  // positional token as the task text. Also accept GOLI_TUI_INITIAL_TASK
  // (set by `commands/run.ts`) so non-spawned callers (tests, future
  // integrations) can pre-seed without quoting through argv.
  let initialTask = '';
  if (isWakeup) {
    initialTask = args.slice(1).join(' ').trim();
  }
  const envTask = (process.env['GOLI_TUI_INITIAL_TASK'] ?? '').trim();
  if (initialTask.length === 0 && envTask.length > 0) {
    initialTask = envTask;
  }

  // Crash-recovery flags (research §21.4).
  const isRecover = args.includes('--recover');
  const isClearCrash = args.includes('--clear-crash');

  // Accessibility / debug (research §16.1 + §23.1).
  const accessibility =
    args.includes('--accessibility') ||
    args.includes('--screen-reader') || // T-033
    process.env['GOLI_CLI_ACCESSIBILITY'] === '1' ||
    process.env['NO_COLOR'] === '1';
  const debug = args.includes('--debug') || process.env['GOLI_CLI_DEBUG'] === '1';

  return {
    showHelp,
    showVersion,
    isWakeup,
    initialTask,
    isRecover,
    isClearCrash,
    accessibility,
    debug,
  };
}

/**
 *
 */
export type LaunchMode = 'interactive' | 'wakeup';

/**
 *
 */
export function toLaunchMode(parsed: ParsedArgs): LaunchMode {
  return parsed.isWakeup ? 'wakeup' : 'interactive';
}
