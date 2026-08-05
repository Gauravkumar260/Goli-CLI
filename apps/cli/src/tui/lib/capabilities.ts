/**
 * lib/capabilities.ts — Terminal capability detection.
 *
 * Source: GOLI_CLI_TUI_DEEP_RESEARCH.md §16.2 (Terminal Capability Detection),
 * §16.3 (SSH / Remote Session Handling), §16.4 (Windows Terminal Support).
 *
 * Detects, once at process start, what the terminal can actually do:
 *   - TrueColor / 256-color / 16-color
 *   - Unicode (box-drawing + braille)
 *   - DEC Synchronized Output (CSI ?2026 h/l) — the flicker killer
 *   - SSH session (animations should be throttled)
 *   - Windows Terminal (WT_SESSION env)
 *
 * All detection is non-interactive: we only read env vars. We never
 * send a query sequence and block on the response (that would freeze
 * the TUI on terminals that don't reply).
 *
 * The result is cached for the process lifetime — terminal capabilities
 * do not change while a process is running.
 */
import process from 'node:process';

/**
 *
 */
export interface TerminalCapabilities {
  /** 24-bit #rrggbb color supported (COLORTERM=truecolor|24bit). */
  trueColor: boolean;
  /** 256-color palette supported (TERM contains "256color"). */
  colors256: boolean;
  /** Unicode box-drawing + braille supported (not a Linux console). */
  unicode: boolean;
  /** DEC Synchronized Output (CSI ?2026 h / ?2026 l) supported. */
  syncOutput: boolean;
  /** Running inside an SSH session (process.env.SSH_CLIENT set). */
  isSSH: boolean;
  /** Windows Terminal (process.env.WT_SESSION set). */
  isWindowsTerminal: boolean;
  /** tmux multiplexer — may need extra escaping for some sequences. */
  isTmux: boolean;
  /** Screen-reading / accessibility mode requested. */
  accessibility: boolean;
  /** Debug overlay requested (GOLI_CLI_DEBUG=1). */
  debug: boolean;
}

let cached: TerminalCapabilities | null = null;

const SYNC_OUTPUT_TERMS = new Set([
  'xterm-256color',
  'xterm-kitty',
  'kitty',
  'alacritty',
  'alacritty-direct',
  'foot',
  'foot-direct',
  'wezterm',
  'tmux-256color',
  'rxvt-unicode-256color',
  'iTerm.app',
  'iTerm2',
]);

const SYNC_OUTPUT_PROGRAMS = new Set([
  'iTerm.app',
  'WezTerm',
  'alacritty',
  'kitty',
  'ghostty',
  'Windows Terminal',
  'tmux',
]);

/**
 * Detect terminal capabilities from environment. Pure function —
 * no side effects, no I/O. Safe to call from anywhere.
 */
export function detectCapabilities(): TerminalCapabilities {
  if (cached) return cached;

  const term = process.env['TERM'] ?? '';
  const termProgram = process.env['TERM_PROGRAM'] ?? '';
  const colorTerm = process.env['COLORTERM'] ?? '';

  const trueColor = colorTerm === 'truecolor' || colorTerm === '24bit';
  const colors256 = term.includes('256color') || trueColor;
  // Linux console (TERM=linux) is ASCII-only and cannot render
  // box-drawing characters or braille. Everything else modern can.
  const unicode = term !== 'linux' && term !== 'dumb';
  const syncOutput =
    SYNC_OUTPUT_TERMS.has(term) ||
    SYNC_OUTPUT_TERMS.has(termProgram) ||
    SYNC_OUTPUT_PROGRAMS.has(termProgram) ||
    term.includes('kitty') ||
    term.includes('alacritty') ||
    term.includes('wezterm') ||
    term.includes('foot');
  const isSSH = !!process.env['SSH_CLIENT'] || !!process.env['SSH_TTY'] || !!process.env['SSH_CONNECTION'];
  const isWindowsTerminal = !!process.env['WT_SESSION'];
  const isTmux = !!process.env['TMUX'];
  const accessibility =
    process.env['GOLI_CLI_ACCESSIBILITY'] === '1' ||
    process.argv.includes('--accessibility') ||
    process.argv.includes('--screen-reader') || // T-033: gemini-cli convention
    process.env['NO_COLOR'] === '1'; // T-033: industry-standard a11y signal
  const debug = process.env['GOLI_CLI_DEBUG'] === '1';

  cached = {
    trueColor,
    colors256,
    unicode,
    syncOutput,
    isSSH,
    isWindowsTerminal,
    isTmux,
    accessibility,
    debug,
  };
  return cached;
}

/**
 * Returns true if the terminal supports DEC Synchronized Output AND
 * we are not in accessibility mode (which prefers simple output).
 *
 * Research §6.1 Layer 2: "DEC Synchronized Output (the flicker killer)".
 */
export function shouldUseSyncOutput(): boolean {
  const c = detectCapabilities();
  return c.syncOutput && !c.accessibility;
}

/**
 * Returns true if we should throttle animations (SSH, accessibility).
 *
 * Research §16.3: "When running over SSH: reduce animation complexity
 * (SSH latency makes fast animations look wrong)."
 */
export function shouldThrottleAnimations(): boolean {
  const c = detectCapabilities();
  return c.isSSH || c.accessibility;
}

/**
 * Reset the capabilities cache (T-033: for tests).
 *
 * Terminal capabilities are cached for the process lifetime — terminal
 * capabilities do not change while a process is running. However, tests
 * need to reset the cache to test different env/argv combinations.
 */
export function resetCapabilitiesCache(): void {
  cached = null;
}
