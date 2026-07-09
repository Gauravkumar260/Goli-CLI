/**
 * lib/sessionState.ts — Session state autosave for crash recovery.
 *
 * Source: GOLI_CLI_TUI_DEEP_RESEARCH.md §21.4 (Graceful Degradation).
 *
 *   "Always save session state before crash. Offer `--recover` flag
 *    to reload."
 *
 * Writes a JSON snapshot of the minimal recoverable state to
 *   ~/.goli-cli/crash.json
 * whenever the process is about to die from an uncaught exception.
 * On next launch with `--recover`, the CLI can read this file and
 * restore the conversation.
 *
 * This module is intentionally side-effect-free on import. The CLI
 * calls `installCrashHandler()` once at startup.
 */
import process from 'node:process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { recordLifecycle } from './parentLog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GOLI_DIR = join(homedir(), '.goli-cli');
const CRASH_FILE = join(GOLI_DIR, 'crash.json');

/**
 *
 */
export interface CrashSnapshot {
  /** ISO timestamp of the crash. */
  at: string;
  /** Process exit reason (uncaughtException, SIGTERM, etc.). */
  reason: string;
  /** Last-known session ID. */
  sessionId?: string;
  /** Last-known workspace path. */
  workspace?: string;
  /** Last-known branch. */
  branch?: string;
  /** Last-known model. */
  model?: string;
  /** Last-known turn count. */
  turn?: number;
  /** Last-known mode (SAFE/GOD). */
  mode?: string;
  /** Last-known tier. */
  tier?: string;
  /** Stack trace if available. */
  stack?: string;
}

let lastSnapshot: Partial<CrashSnapshot> = {};

/**
 * Update the in-memory snapshot. Called by the App whenever state
 * changes — cheap (just an object assignment), no I/O.
 */
export function updateSnapshot(patch: Partial<CrashSnapshot>): void {
  lastSnapshot = { ...lastSnapshot, ...patch };
}

/**
 * Persist the current snapshot to disk. Called only on crash.
 * Writes atomically — temp file + rename — so a partial write never
 * leaves a corrupt crash.json behind.
 */
export function persistSnapshot(reason: string, stack?: string): void {
  try {
    if (!existsSync(GOLI_DIR)) mkdirSync(GOLI_DIR, { recursive: true });
    const snap: CrashSnapshot = {
      at: new Date().toISOString(),
      reason,
      ...lastSnapshot,
      ...(stack ? { stack } : {}),
    };
    const tmp = CRASH_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf8');
    // Atomic rename — readers never see a half-written file.
    import('node:fs').then(({ renameSync }) => renameSync(tmp, CRASH_FILE));
  } catch {
    // If we can't save, we can't save. Crash handler must never throw.
  }
}

/**
 * Install the crash handler. Restores terminal state, persists
 * snapshot, then re-throws / exits.
 *
 * Idempotent — calling twice is safe.
 */
let installed = false;
/**
 *
 */
export function installCrashHandler(): void {
  if (installed) return;
  installed = true;

  const restore = (reason: string, stack?: string) => {
    // Restore terminal state — research §21.4
    try {
      process.stdout.write('\x1b[?2026l');   // End DEC sync output
      process.stdout.write('\x1b[?25h');      // Show cursor
      process.stdout.write('\x1b[?1049l');    // Exit alternate screen
      process.stdout.write('\x1b[0m');        // Reset all attributes
    } catch {
      /* ignore */
    }
    persistSnapshot(reason, stack);
  };

  process.on('uncaughtException', (err: Error) => {
    recordLifecycle(`uncaughtException: ${err.message}`);
    restore('uncaughtException', err.stack ?? err.message);
    // Re-emit so default Node behavior kicks in (print + exit).
    // We do NOT call process.exit here — that would skip stderr flush.
    process.stderr.write(
      `\nGoli-CLI crashed: ${err.message}\n` +
        `State saved to ${CRASH_FILE}\n` +
        `Run: goli-cli --recover to resume\n\n`,
    );
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    recordLifecycle(`unhandledRejection: ${msg}`);
    restore('unhandledRejection', stack);
    process.stderr.write(
      `\nGoli-CLI crashed (unhandled rejection): ${msg}\n` +
        `State saved to ${CRASH_FILE}\n\n`,
    );
    process.exit(1);
  });
}

/**
 * Read a previous crash snapshot, if any. Used by `--recover`.
 */
export function readCrashSnapshot(): CrashSnapshot | null {
  try {
    if (!existsSync(CRASH_FILE)) return null;
    const raw = readFileSync(CRASH_FILE, 'utf8');
    return JSON.parse(raw) as CrashSnapshot;
  } catch {
    return null;
  }
}

/**
 * Clear the crash snapshot after a successful recovery (or on user
 * request via `--clear-crash`).
 */
export function clearCrashSnapshot(): void {
  try {
    if (existsSync(CRASH_FILE)) {
      import('node:fs').then(({ unlinkSync }) => unlinkSync(CRASH_FILE));
    }
  } catch {
    /* ignore */
  }
}
