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
 * Strip C0 control characters and the OSC string terminator (ST) from a
 * string so it cannot prematurely terminate an OSC-8 hyperlink sequence.
 *
 * P0-9 fix: The previous `formatUrl()` interpolated `url` and `text`
 * verbatim into the OSC-8 template
 *
 *   `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`
 *
 * If `url` (or `text`) contained a BEL (`\x07`) or ESC (`\x1b`), it
 * would terminate the OSC sequence early and the remainder would be
 * interpreted as raw terminal escape codes. A malicious URL like
 * `http://evil.com\x07\x1b[2J\x07` would clear the user's screen
 * (or worse — write arbitrary escape sequences). URLs reach this code
 * from untrusted agent output (tool results, web_fetch), so this is a
 * real injection vector, not just a theoretical concern.
 *
 * The OSC-8 spec restricts the URI to printable ASCII + a few safe
 * punctuation chars; control characters are not legal. We strip them
 * rather than reject the whole URL because (a) the user almost never
 * benefits from control chars in a URL, and (b) silently dropping the
 * link would be a worse UX than emitting a sanitized link.
 *
 * We strip:
 *   - All C0 controls (U+0000–U+001F) including BEL (0x07) and ESC (0x1b)
 *   - DEL (U+007F)
 *   - The OSC string-terminator forms `\x1b\\` (ST) and lone `\x07` (BEL)
 *     — the BEL strip is already covered by C0, but we list it explicitly
 *     for clarity.
 *   - The C1 control range (U+0080–U+009F) for defence-in-depth, since
 *     some terminals interpret these as control sequences in certain
 *     8-bit modes.
 */
function sanitizeForOsc8(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
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
  // P0-9 fix: Sanitize both `url` and `text` before interpolating into
  // the OSC-8 template. See `sanitizeForOsc8` for the threat model.
  const safeUrl = sanitizeForOsc8(url);
  const safeText = sanitizeForOsc8(text);
  // OSC 8 ; ; <URI> BEL  text  OSC 8 ; ; BEL
  return `\x1b]8;;${safeUrl}\x07${safeText}\x1b]8;;\x07`;
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
