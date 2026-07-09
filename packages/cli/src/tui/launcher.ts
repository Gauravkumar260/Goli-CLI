/**
 * TUI launcher — runs the Ink TUI directly in-process.
 *
 * This avoids Windows subprocess TTY issues by importing and running
 * the TUI's main function directly. A process.exit guard prevents the
 * TUI's exit() calls from killing the parent CLI process.
 *
 * @module tui/launcher
 */

/**
 * Launch the TUI with the given args.
 *
 * Dynamically imports cli.tsx and runs main() in-process, preserving
 * full TTY access for Ink's raw-mode rendering.
 *
 * @param args - The args to pass (e.g. ['wakeup', 'refactor the auth module'])
 * @returns Exit code from the TUI process.
 */
export async function launchTui(args: string[] = []): Promise<number> {
  const origArgv = process.argv;
  const origExit = process.exit;

  // Override argv so cli.tsx parseArgs sees our args
  process.argv = [origArgv[0], origArgv[1] ?? 'goli', ...args];

  // Guard process.exit so the TUI can't kill the parent CLI process
  let exitCode = 0;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    // Don't actually exit — just record the code
  }) as (code?: number) => never;

  try {
    const { tuiMain } = await import('./cli.js');
    await tuiMain().catch((err: unknown) => {
      exitCode = 1;
      process.stderr.write(`TUI error: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  } catch (err) {
    exitCode = 1;
    process.stderr.write(`TUI load error: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.argv = origArgv;
    process.exit = origExit;
  }

  return exitCode;
}
