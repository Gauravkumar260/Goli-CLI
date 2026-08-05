/**
 * lib/supportsHyperlinks.ts — Detect OSC-8 hyperlink support.
 *
 * Verbatim port of `packages/hermes-ink/src/ink/supports-hyperlinks.ts`
 * from hermes-agent (see F:\Downloads\hermes-agent-main\hermes-agent-main).
 * Adapted to goli's flat-module layout (no package-private utils to
 * import).
 *
 * Output is consumed by `formatUrl()` in this same directory, which
 * decides whether to emit OSC-8 escape sequences around URLs in
 * streamed agent output. The detection logic itself is identical to
 * the upstream file: it prefers the `supports-hyperlinks` npm library,
 * then layers two known omissions on top (kitty / ghostty / alacritty
 * / iTerm) that the underlying library didn't catch at the time of
 * the port.
 *
 * Why the env-var test seam? The original hermes version takes
 * `(env, stdoutSupported)` as test-only args so unit tests can
 * freeze the output. Goli's test suite is `vitest`; we keep that
 * seam so future tests can assert branch coverage without monkey-
 * patching `process.env`.
 */
import supportsHyperlinksLib from 'supports-hyperlinks';

/**
 *
 */
export const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
];

/**
 *
 */
export interface SupportsHyperlinksOptions {
  env?: Record<string, string | undefined>;
  stdoutSupported?: boolean;
}

/**
 *
 */
export function supportsHyperlinks(
  options?: SupportsHyperlinksOptions,
): boolean {
  const stdoutSupported =
    options?.stdoutSupported ?? supportsHyperlinksLib.stdout;

  if (stdoutSupported) {
    return true;
  }

  const env = options?.env ?? process.env;

  // TERM_PROGRAM is the canonical "what terminal am I" signal set by
  // most modern terminals (iterm2, vscode, apple terminal, …).
  const termProgram = env['TERM_PROGRAM'];
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    return true;
  }

  // LC_TERMINAL is preserved inside tmux where TERM_PROGRAM is
  // overwritten to 'tmux'. Some terminals (iTerm2) only set this one
  // reliably when running under tmux.
  const lcTerminal = env['LC_TERMINAL'];
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    return true;
  }

  // Kitty sets TERM=xterm-kitty and is the only terminal in our list
  // that doesn't ship its identity in TERM_PROGRAM/LC_TERMINAL.
  const term = env['TERM'];
  if (term && term.includes('kitty')) {
    return true;
  }

  return false;
}
