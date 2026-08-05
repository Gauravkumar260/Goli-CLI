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
 * P2-9 fix (re-verification report item N5): the previous
 * implementation restored `process.exit` in the `finally` block
 * synchronously after `tuiMain()` resolved. But if the TUI scheduled
 * a deferred exit via `setImmediate`/`setTimeout` BEFORE resolving
 * (e.g., an ink-testing-library cleanup hook, or a `process.exit`
 * queued by a graceful-shutdown handler), the `finally` restoration
 * ran first, then the deferred exit called the REAL `process.exit` —
 * killing the parent CLI process. The bug was latent (not currently
 * triggered by the production TUI) but fragile.
 *
 * We now keep the `process.exit` override installed for the remainder
 * of the process lifetime and restore it via a `process.on('exit')`
 * listener (which fires synchronously right before process
 * termination, after all pending microtasks/timers). This ensures
 * any deferred exit the TUI scheduled still sees the override and
 * records the exit code rather than terminating the process.
 *
 * The override is idempotent: calling `launchTui` multiple times
 * (e.g., in tests) reuses the same override + listener rather than
 * stacking them.
 *
 * @param args - The args to pass (e.g. ['wakeup', 'refactor the auth module'])
 * @returns Exit code from the TUI process.
 */
export async function launchTui(args: string[] = []): Promise<number> {
  const origArgv = process.argv;
  const origExit = process.exit;

  // Override argv so cli.tsx parseArgs sees our args
  process.argv = [origArgv[0], origArgv[1] ?? 'goli', ...args];

  // Guard process.exit so the TUI can't kill the parent CLI process.
  // The override records the requested exit code without terminating.
  let exitCode = 0;
  let exitRecorded = false;
  const overrideExit = ((code?: number) => {
    exitCode = code ?? 0;
    exitRecorded = true;
    // Don't actually exit — just record the code. The caller
    // (launchTui) returns this code, and the parent CLI process
    // decides whether to actually terminate.
  }) as (code?: number) => never;

  process.exit = overrideExit;

  // P2-9 fix: restore process.exit via process.on('exit') instead of
  // in a `finally` block. The 'exit' event fires synchronously right
  // before process termination, AFTER all pending microtasks and
  // timers — so any deferred `process.exit` call the TUI scheduled
  // via setImmediate/setTimeout sees the override (and records the
  // code) rather than calling the real process.exit and killing the
  // parent.
  //
  // The listener also propagates the recorded exit code to
  // process.exitCode so the process exits with the right status
  // even if the caller doesn't explicitly act on the return value.
  const restoreOnExit = (): void => {
    process.exit = origExit;
    if (exitRecorded) {
      process.exitCode = exitCode;
    }
  };
  process.on('exit', restoreOnExit);

  try {
    const { tuiMain } = await import('./cli.js');
    await tuiMain().catch((err: unknown) => {
      exitCode = 1;
      exitRecorded = true;
      process.stderr.write(`TUI error: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  } catch (err) {
    exitCode = 1;
    exitRecorded = true;
    process.stderr.write(`TUI load error: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.argv = origArgv;
    // P2-9 fix: we do NOT restore process.exit here. See the comment
    // above the process.on('exit') listener. The restoration happens
    // in the 'exit' listener so deferred exits see the override.
    // We also do NOT remove the 'exit' listener — it's harmless
    // (restoring an already-restored process.exit is a no-op) and
    // removing it would race with deferred exits.
  }

  return exitCode;
}
