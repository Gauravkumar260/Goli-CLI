/**
 * lib/formatUrl.ts — Render a URL as a clickable OSC-8 hyperlink.
 *
 * OSC-8 (the spec's name: "Operating System Command 8") is the
 * escape sequence terminals use to embed an HTTP(S) target inside a
 * segment of text. Clickable text in any modern terminal that
 * supports it (iTerm2, WezTerm, kitty, alacritty, Windows Terminal,
 * ghostty, …).
 *
 * Behavioural contract (no UI change by default):
 *   - When `GOLI_TUI_HYPERLINKS=1` is unset → returns `text` exactly
 *     as-is. Existing renders are byte-identical.
 *   - When `GOLI_TUI_HYPERLINKS=1` is set AND the running terminal
 *     supports OSC-8 → emits `\x1b]8;;URL\x07text\x1b]8;;\x07`.
 *   - When the flag is set but the terminal doesn't support OSC-8 →
 *     returns `text` (not `text (url)` — we don't know the user's
 *     preference for disambiguating link vs label, so the safe
 *     fallback is to keep showing whatever `text` says and let the
 *     caller decide to also print the URL separately).
 *
 * The OSC-8 spec puts the URL between the "OSC 8 ; ; <URI> ST" prefix
 * and a "OSC 8 ; ; ST" terminator. Many terminals accept BEL (`\x07`)
 * in place of ST (`\x1b\\`) as the string terminator; BEL is shorter
 * and compatible with the vast majority of OSC-8 terminals, so we use
 * it. (Hermes does the same in its `emitHyperlink` implementation.)
 */
import { supportsHyperlinks } from './supportsHyperlinks.js';

const ENABLED = process.env['GOLI_TUI_HYPERLINKS'] === '1';

/** Public so other components can branch the same way as `formatUrl()`. */
export function isHyperlinksEnabled(): boolean {
  return ENABLED;
}

/**
 *
 */
export interface FormatUrlOptions {
  /**
   * Override the support check (used by tests). Defaults to the
   * hermes-port implementation in `supportsHyperlinks.ts`.
   */
  terminalSupportsHyperlinks?: boolean;
}

/**
 * Wrap `text` as an OSC-8 hyperlink pointing at `url`. Returns the
 * un-wrapped `text` when the feature is disabled or the terminal
 * doesn't support OSC-8 — so it's safe to call unconditionally.
 */
export function formatUrl(
  text: string,
  url: string,
  options: FormatUrlOptions = {},
): string {
  if (!ENABLED) return text;
  const supported = options.terminalSupportsHyperlinks ?? supportsHyperlinks();
  if (!supported) return text;
  // OSC 8 ; ; <URI> BEL  text  OSC 8 ; ; BEL
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

/**
 * Test seam — lets unit tests force the "off" path without mutating
 * process.env (which is module-load-captured by the `ENABLED` const
 * for performance; see file header).
 */
export function __resetForTests(): void {
  // No-op stub kept for future vitest coverage. The compiled binary
  // has no use for it; tests can call clearEnv/setEnv to exercise
  // branches.
}
