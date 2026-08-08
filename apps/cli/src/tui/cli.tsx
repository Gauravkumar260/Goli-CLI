/**
 * cli.tsx — Ink entry point.
 *
 * Parses a small argument grammar, primes the AppStateStore with
 * workspace/branch info, then mounts <App /> via Ink.
 *
 * Usage:
 *   goli                       interactive TUI (default)
 *   goli wakeup                interactive TUI (alias used by CliAgentLoop)
 *   goli wakeup --json         interactive TUI (legacy flag, accepted)
 *   goli --interactive         interactive TUI (legacy flag, accepted)
 *   goli --help / -h           print help
 *   goli --version / -V        print version
 *
 * `wakeup`, `--json`, `-j`, `--interactive`, `-i` are all accepted as
 * launch aliases — they all launch the same Ink TUI. `wakeup` skips
 * the welcome splash since CliAgentLoop already has session context.
 *
 * Research-driven hardening (no design change):
 *   - DEC Synchronized Output wrapper (eliminates flicker)
 *   - Crash handler that restores terminal state + saves session
 *   - OSC 0/2 window title updates
 *   - Terminal capability detection
 *   - Proper SIGWINCH handling is in App.tsx (re-reads cols on resize)
 */
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { render } from 'ink';
import { App, type LaunchMode } from './App.js';
import { AppStateStore } from './state/AppStateStore.js';
import { parseArgs, toLaunchMode } from './args.js';
// P3-30 fix: import APP_VERSION / APP_NAME from constants.ts so the TUI
// shows the same version as `goli --version` and `goli --about`.
import { APP_VERSION, APP_NAME } from '../constants.js';
import { detectCapabilities } from './lib/capabilities.js';
import { installSyncOutput } from './lib/syncOutput.js';
import {
  installCrashHandler,
  updateSnapshot,
  readCrashSnapshot,
  clearCrashSnapshot,
} from './lib/sessionState.js';
import { setupGracefulExit } from './lib/gracefulExit.js';
import { recordLifecycle } from './lib/parentLog.js';
import { resetTerminalModes } from './lib/terminalModes.js';
import { startMemoryMonitor, isHeapMonitorEnabled } from './lib/memoryMonitor.js';

// P3-30 fix: use APP_VERSION from constants.ts
const VERSION = APP_VERSION;
// P3-30 fix: use APP_NAME from constants.ts
const NAME = APP_NAME;
const startTime = Date.now();

function printHelp(): void {
  const banner = [
    `${NAME} v${VERSION}`,
    '',
    'Open the goli-cli terminal UI (Ink + React).',
    '',
    'USAGE',
    '  goli                       Open interactive TUI (default).',
    '  goli wakeup                Open interactive TUI (legacy alias, no splash).',
    '  goli wakeup --json         Open interactive TUI (legacy alias).',
    '  goli --interactive         Open interactive TUI (legacy alias).',
    '  goli --help                Print this help.',
    '  goli --version             Print version.',
    '  goli --recover             Resume from last crash snapshot.',
    '  goli --clear-crash         Discard last crash snapshot.',
    '  goli --accessibility       Screen-reader mode (no animations).',
    '',
    'INSIDE THE TUI',
    '  Enter     Submit prompt',
    '  Ctrl+C    Abort / quit',
    '  Ctrl+D    Quit (when idle)',
    '  Ctrl+G    Toggle god mode',
    '  Esc       Abort current operation',
    '',
    'ENVIRONMENT',
  '  GOLI_TUI_FPS=1              Render-time FPS overlay in status bar.',
    '  GOLI_TUI_HYPERLINKS=1       OSC-8 clickable URLs (opt-in, harmless default-off).',
    '  GOLI_TUI_MODE               Set to the active launch alias (e.g. "wakeup").',
    '  GOLI_CLI_DEBUG=1            Show debug overlay (research §23.1).',
    '  GOLI_CLI_ACCESSIBILITY=1    Force accessibility mode.',
  ].join('\n');
  console.log(banner);
}

function detectBranch(): string {
  try {
    const r = spawnSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status === 0 && typeof r.stdout === 'string') {
      const b = r.stdout.trim();
      if (b.length > 0) return b;
    }
  } catch {
    /* ignore */
  }
  return 'no-git';
}

/**
 * Set the terminal window title via OSC 0/2.
 *
 * Research §3.1 (Claude Code): "Terminal tab title updates via OSC
 * escape sequences". This is purely cosmetic — invisible inside the
 * TUI itself but visible in the terminal tab/title bar. No design
 * change to the TUI surface.
 */
function setWindowTitle(title: string): void {
  try {
    // OSC 0 ; <title> BEL  — sets both icon and window title.
    // Most modern terminals (xterm, iTerm2, Windows Terminal, Alacritty,
    // kitty, WezTerm, tmux) support this.
    process.stdout.write(`\x1b]0;${title}\x07`);
  } catch {
    /* ignore — title is cosmetic */
  }
}

/**
 * Restore terminal to a clean state on exit.
 *
 * Research §21.4 (Graceful Degradation): always show cursor, exit
 * alternate screen, end DEC sync mode, reset attributes.
 */
function restoreTerminal(): void {
  // 1. Comprehensive terminal-mode reset — clears any modes the user's
  //    terminal had on BEFORE goli launched that goli didn't explicitly
  //    toggle (mouse tracking, focus events, kitty keyboard flags, etc.).
  //    No UI change to the TUI itself; this only affects what the user's
  //    shell inherits AFTER goli exits.
  // 2. Then the small original Ink-only cleanup (cursor, alt screen,
  //    attributes, window title).
  try {
    resetTerminalModes(process.stdout);
  } catch {
    /* ignore */
  }
  try {
    process.stdout.write('\x1b[?2026l');   // End DEC sync output
    process.stdout.write('\x1b[?25h');      // Show cursor
    process.stdout.write('\x1b[?1049l');    // Exit alternate screen
    process.stdout.write('\x1b[0m');        // Reset all attributes
    // Clear the window title we set on startup.
    process.stdout.write('\x1b]0;\x07');
  } catch {
    /* ignore */
  }
}

/**
 *
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const initialMode: LaunchMode = toLaunchMode(parsed);

  if (parsed.showHelp) {
    printHelp();
    process.exit(0);
  }
  if (parsed.showVersion) {
    console.log(`${NAME} v${VERSION}`);
    process.exit(0);
  }

  // Recover from a previous crash, if asked.
  if (process.argv.includes('--recover')) {
    const snap = readCrashSnapshot();
    if (snap) {
      console.log(
        `Recovered crash snapshot from ${snap.at} (${snap.reason}).\n` +
          `Session: ${snap.sessionId ?? 'unknown'} · Workspace: ${snap.workspace ?? 'unknown'}\n`,
      );
    } else {
      console.log('No crash snapshot found.');
    }
  }
  if (process.argv.includes('--clear-crash')) {
    clearCrashSnapshot();
    console.log('Cleared crash snapshot.');
    process.exit(0);
  }

  // Surface the launch mode to downstream code (the agent loop, the
  // bootstrap, telemetry) so they can adapt — e.g. CliAgentLoop
  // spawning `goli wakeup` may want to skip onboarding screens.
  process.env['GOLI_TUI_MODE'] = initialMode;

  // Prime the singleton store with workspace info before render so the
  // welcome box (when shown) displays the right branch/workspace.
  AppStateStore.patch({
    sessionId: randomUUID(),
    workspace: process.cwd(),
    branch: detectBranch(),
  });

  // Detect terminal capabilities once. The result is cached for the
  // process lifetime — terminal capabilities don't change mid-run.
  // (Side-effect-free; we just log it in debug mode.)
  const caps = detectCapabilities();
  if (caps.debug) {
     
    console.error(
      '[goli-tui] capabilities: ' +
        `trueColor=${caps.trueColor} ` +
        `256color=${caps.colors256} ` +
        `unicode=${caps.unicode} ` +
        `syncOutput=${caps.syncOutput} ` +
        `ssh=${caps.isSSH} ` +
        `wt=${caps.isWindowsTerminal} ` +
        `tmux=${caps.isTmux} ` +
        `a11y=${caps.accessibility}`,
    );
  }

  // Install DEC Synchronized Output wrapper (research §6.1 Layer 2).
  // No-op if the terminal doesn't support it.
  installSyncOutput();

  // Install crash handler (research §21.4) — restores terminal + saves
  // state on uncaughtException / unhandledRejection.
  installCrashHandler();

  // Lifecycle breadcrumb (this round): record that we got as far as installing
  // the crash handler. Subsequent breadcrumbs log the snapshot subscription,
  // setup, signal-reception, and exit. Disabled under VITEST (see parentLog.ts).
  recordLifecycle(`start pid=${process.pid} argv=${JSON.stringify(process.argv.slice(2))}`);

  // Update crash snapshot whenever the store changes — cheap (object
  // assignment), no I/O. The snapshot is only persisted on crash.
  const unsub = AppStateStore.subscribe((snap) => {
    updateSnapshot({
      sessionId: snap.sessionId,
      workspace: snap.workspace,
      branch: snap.branch,
      model: snap.model,
      turn: snap.turn,
      mode: snap.mode,
      tier: snap.tier,
    });
  });

  const bootstrapMs = Date.now() - startTime;

  // Set the terminal window title (research §3.1). Visible only in the
  // terminal tab/title bar — does not change the TUI surface.
  setWindowTitle(`goli-cli · ${AppStateStore.getSnapshot().branch}`);

  // Non-TTY guard (research §21 graceful degradation):
  // If stdout/stderr aren't TTY (CI, pipe redirection, embedded terminal),
  // Ink's raw-mode init will throw and crash. Bail with a clear message.
  if (!process.stdout.isTTY || !process.stderr.isTTY) {
     
    console.error(
      '[goli-tui] Cannot launch TUI: stdin and stdout are not a TTY.\n' +
        '          Run the command from a real terminal, or pass a task argument.',
    );
    process.exit(0);
  }

  // Mount <App /> via Ink. If the caller pre-supplied a task
  // (`goli wakeup "<task>"` or GOLI_TUI_INITIAL_TASK), pass it down so
  // App auto-submits once the splash renders — turning the TUI into a
  // true one-shot launcher for tasks the parent process queued up.
  const instance = render(
    React.createElement(App, {
      bootstrapMs,
      initialMode,
      hideWelcome: initialMode === 'wakeup',
      initialPrompt: parsed.initialTask,
    }),
    {
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  // Wire process signals for clean shutdown. Ported from
  // hermes-agent's `setupGracefulExit` (lib/gracefulExit.ts): runs
  // the cleanups, then exits; if any cleanup hangs, a failsafe timer
  // exits anyway after 4s. Idle paths (Ctrl+D in `App.tsx`) unmount
  // Ink directly, which triggers `await instance.waitUntilExit()` below,
  // which in turn triggers our cleanups with the same exit code 0.
  setupGracefulExit({
    failsafeMs: 4000,
    cleanups: [
      () => restoreTerminal(),
      () => instance.unmount(),
      () => unsub(),
    ],
    onSignal: (sig) => recordLifecycle(`signal received: ${sig}`),
  });
  recordLifecycle('setup complete, awaiting signal or waitUntilExit');

  // Optional heap-pressure watchdog. OFF by default; activates only when
  // GOLI_TUI_HEAPMON=1 is set in the environment. Catches the silent-OOM
  // regime (#34095 in hermes-agent) where a render-tree blowup takes Node
  // down without ever crossing the visible exit threshold. Writes a heap
  // snapshot + breadcrumb on triggers — see memoryMonitor.ts for the
  // thresholds and cooldown policy.
  if (isHeapMonitorEnabled()) {
    recordLifecycle('heap-monitor enabled via GOLI_TUI_HEAPMON=1');
    startMemoryMonitor({
      onWarn: (snap) => recordLifecycle(`heap-warn heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(1)}MB rss=${(snap.rss / 1024 / 1024).toFixed(1)}MB`),
      onHigh: (snap, dump) => recordLifecycle(`heap-high heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(1)}MB dump=${dump?.heapPath ?? 'none'}`),
      onCritical: (snap, dump) => recordLifecycle(`heap-critical heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(1)}MB dump=${dump?.heapPath ?? 'none'}`),
    });
  }

  // Wait until Ink unmounts (Ctrl+D in idle state, etc.)
  try {
    await instance.waitUntilExit();
    recordLifecycle('ink unmounted cleanly (waitUntilExit resolved)');
  } finally {
    restoreTerminal();
    unsub();
  }
  process.exit(0);
}

// Export for programmatic use via launcher.ts
/**
 *
 */
export { main as tuiMain };

// Auto-execute only when this file is the direct entry point
const isEntry = process.argv[1] && (
  process.argv[1].replace(/\\/g, '/').endsWith('cli.tsx') ||
  process.argv[1].replace(/\\/g, '/').endsWith('cli.js')
);
if (isEntry) {
  main().catch((err) => {
    restoreTerminal();
    recordLifecycle(`fatal startup error: ${(err as Error)?.message ?? String(err)}`);
     
    console.error('Fatal error starting goli-tui:', err);
    process.exit(1);
  });
}
