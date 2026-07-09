/**
 * lib/parentLog.ts — Lifecycle breadcrumbs for the goli-tui parent process.
 *
 * Ported from hermes-agent (hermes-agent-main/ui-tui/src/lib/parentLog.ts).
 * Goli does not spawn a Python gateway subprocess the way Hermes does, but
 * the same diagnostic story applies to a single-process TUI: when the user
 * reports "the TUI froze on launch" or "I pressed Enter and nothing happened",
 * the only evidence left is the exit code and (sometimes) stderr. A
 * structured breadcrumb log lets us reconstruct *what happened* — when did
 * the snapshot first load, when did Ink unmount, when did the crash handler
 * fire, when did the timeout escape — without trusting user memory.
 *
 * The log file is written under `~/.goli-cli/logs/tui.log` and is intentionally
 * tiny. It is NOT a transcript, NOT a metric sink, NOT telemetry — just a
 * six-line breadcrumb file you can `tail` to figure out why your terminal
 * exited.
 *
 * Performance / behaviour notes (no UI change):
 *   - Disabled under VITEST so unit tests stay hermetic.
 *   - Each call uses `appendFileSync` (O(1) syscall, no buffering). One line
 *     per call is the only constraint. We swallow IO errors and warn once
 *     per process so a read-only $HOME doesn't spam stderr.
 *   - Line values are capped at MAX_BREADCRUMB chars and have newlines
 *     collapsed so a multi-line error message can't masquerade as multiple
 *     entries.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const logDir = join(
  process.env['GOLI_HOME']?.trim() || join(homedir(), '.goli-cli'),
  'logs',
);
const LOG_FILE = join(logDir, 'tui.log');

const enabled = !process.env['VITEST'];
const MAX_BREADCRUMB = 4096;
let warned = false;

/**
 * Append a lifecycle breadcrumb to `~/.goli-cli/logs/tui.log`.
 *
 * Safe to call from any point in the process lifecycle. Lines are tagged
 * `[tui]` for grep-ability and interleaved with timestamps so they can be
 * merged with the agent's own session crash log.
 */
export function recordLifecycle(line: string): void {
  if (!enabled) return;
  try {
    const oneLine = line.replace(/[\r\n]+/g, ' ↩ ');
    const capped =
      oneLine.length > MAX_BREADCRUMB
        ? `${oneLine.slice(0, MAX_BREADCRUMB)}… [truncated ${oneLine.length} chars]`
        : oneLine;
    mkdirSync(logDir, { recursive: true });
    appendFileSync(LOG_FILE, `[tui] ${new Date().toISOString()} ${capped}\n`);
  } catch {
    if (!warned) {
      warned = true;
      process.stderr.write('goli-tui: lifecycle log unavailable\n');
    }
  }
}

/**
 * Resolve the log file path. Exposed for `--show-log-path` / debugging.
 */
export function getLifecycleLogPath(): string {
  return LOG_FILE;
}
