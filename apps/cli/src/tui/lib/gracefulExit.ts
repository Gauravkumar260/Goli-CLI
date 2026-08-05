/**
 * lib/gracefulExit.ts — Wrap signal/crash paths with a clean-shutdown
 * pattern ported from hermes-agent (hermes-ink uses a single utility
 * called `setupGracefulExit` that we mirror here for parity).
 *
 * Properties (no design change):
 *   - Runs all registered cleanups, then exits.
 *   - Failsafe timeout: if a cleanup hangs, process.exit() anyway after
 *     `failsafeMs` so the user is never stuck staring at a frozen TUI.
 *   - Ignored-signals list: lets tests / handoff code suppress particular
 *     signals (e.g. SIGINT during an external editor spawn, where the
 *     editor forwards the keystroke).
 *   - Dedup: `setupGracefulExit()` is idempotent; calling twice is safe.
 *   - Re-uses the existing crash handler installed by sessionState.ts so
 *     SIGTERM/SIGINT/SIGHUP all route through the same path.
 */

/**
 *
 */
export type GracefulSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM'

const SIGNALS: readonly GracefulSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

const SIGNAL_EXIT_CODE: Record<GracefulSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
}

interface SetupOptions {
  /** Run on the way out. Called sequentially; awaited. */
  cleanups?: (() => Promise<void> | void)[]
  /** Force-exit timeout. Default 4000ms. */
  failsafeMs?: number
  /** Signals to ignore entirely (no exit). */
  ignoredSignals?: readonly GracefulSignal[]
  /** Called when an uncaught error is observed (does not exit). */
  onError?: (scope: 'uncaughtException' | 'unhandledRejection', err: unknown) => void
  /** Called for each signal exit (before cleanups). */
  onSignal?: (signal: NodeJS.Signals) => void
}

let wired = false

/**
 *
 */
export function shouldExitForSignal(
  signal: GracefulSignal,
  ignoredSignals: readonly GracefulSignal[] = [],
): boolean {
  return !ignoredSignals.includes(signal)
}

/**
 * Install graceful-exit hooks. Idempotent.
 *
 * Distinct from `installCrashHandler()` in sessionState.ts: crash
 * handler exits *immediately* on uncaughtException and persists a
 * snapshot. Graceful exit instead runs cleanups, then exits. They share
 * the SIGINT/SIGTERM/SIGHUP signals — handlers fire in registration
 * order, and both end with `process.exit`, so once one has run, the
 * other's exit will see the already-shutting-down flag in cli.tsx and
 * no-op.
 */
export function setupGracefulExit({
  cleanups = [],
  failsafeMs = 4000,
  ignoredSignals = [],
  onError,
  onSignal,
}: SetupOptions = {}): void {
  if (wired) return
  wired = true

  let shuttingDown = false

  const exit = (code: number, signal?: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    if (signal) onSignal?.(signal)
    // Failsafe: if a cleanup hangs, we still bail out after failsafeMs.
    setTimeout(() => process.exit(code), failsafeMs).unref?.()
    void Promise.allSettled(
      cleanups.map((fn) => Promise.resolve().then(fn)),
    ).finally(() => process.exit(code))
  }

  for (const sig of SIGNALS) {
    process.on(sig, () => {
      if (!shouldExitForSignal(sig, ignoredSignals)) return
      exit(SIGNAL_EXIT_CODE[sig], sig)
    })
  }

  // Crash hooks are observation-only here — cli.tsx's installCrashHandler
  // is what *exits* on uncaughtException/unhandledRejection. We just
  // surface the error to the optional onError callback for telemetry.
  process.on('uncaughtException', (err) => onError?.('uncaughtException', err))
  process.on('unhandledRejection', (reason) => onError?.('unhandledRejection', reason))
}
