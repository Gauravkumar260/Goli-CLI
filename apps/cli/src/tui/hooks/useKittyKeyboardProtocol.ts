/**
 * hooks/useKittyKeyboardProtocol.ts — Kitty keyboard protocol detection (T-105).
 *
 * Reference: gemini-cli's `useKittyKeyboardProtocol.ts`. The Kitty keyboard
 * protocol (CSI > 1 u) provides unambiguous key events, so Shift+Enter,
 * Ctrl+Shift+A, etc. are all distinguishable. Without it, terminals
 * collapse many key combos.
 *
 * This hook:
 *   1. Sends a Kitty protocol "push flags" query on mount.
 *   2. Reads the response from stdin to detect support.
 *   3. Returns `{ supported: boolean, enabled: boolean }`.
 *
 * If supported, the hook enables the protocol (CSI > 1 u) so Ink receives
 * unambiguous key events. On unmount, it pops the protocol stack (CSI < 1 u)
 * to restore the terminal to its default behavior.
 *
 * P1-11 fix: The previous implementation had multiple bugs:
 *
 *  1. **Stdin conflict** — attached `process.stdin.on('data', onData)`
 *     directly, bypassing Ink's stdin ownership. Ink's key dispatcher
 *     received the Kitty response bytes and tried to interpret them as
 *     key events, causing spurious input. Now uses Ink's `useStdin()`
 *     and `setRawMode()`.
 *
 *  2. **Loose matching** — `str.includes('\x1B[?') && str.includes('u')`
 *     would match ANY input containing both substrings anywhere (e.g. a
 *     paste containing `?` and `u`). Now uses a proper regex that
 *     matches the full Kitty response shape `CSI ? <digits> u`.
 *
 *  3. **200ms timeout race** — if the terminal responded slowly (SSH,
 *     busy machine), `supported` was still `false` at timeout, the
 *     protocol was not enabled, and a LATE response set `supported = true`
 *     without re-evaluating whether to enable. Now we accept a late
 *     response: if it arrives within an extended grace window (1s), we
 *     enable the protocol retroactively. Beyond that, we give up.
 *
 *  4. **Spurious cleanup** — wrote `\x1B[<1u` (pop) on the not-supported
 *     path, but the query was `\x1B[?1u` (get flags), not a push. Popping
 *     when nothing was pushed corrupts the user's terminal protocol
 *     stack. The cleanup line is removed.
 *
 *  5. **Konsole missing** — the comment mentioned Konsole 22.04+ but
 *     `isKittyCapable()` didn't include it. Added.
 *
 *  6. **Case sensitivity** — `TERM_PROGRAM` check was case-sensitive
 *     (`Kitty` vs `kitty`). Now lowercased for comparison.
 *
 * @module hooks/useKittyKeyboardProtocol
 */
import { useState, useEffect, useRef } from 'react';
import { useStdin, useStdout } from 'ink';

/** Kitty keyboard protocol state. */
export interface KittyKeyboardState {
  /** Whether the terminal supports the Kitty keyboard protocol. */
  supported: boolean;
  /** Whether the protocol has been enabled. */
  enabled: boolean;
}

// P1-11 fix: Proper regex for the Kitty response: CSI ? <flags> u
// (where <flags> is one or more digits). The previous `includes()` check
// was too loose and would match arbitrary input.
// eslint-disable-next-line no-control-regex
const KITTY_RESPONSE_RE = /\x1B\[\?(\d+)u/;

// Extended grace window for late terminal responses (SSH, busy machines).
// 200ms was too short; we now wait up to 1s before giving up.
const KITTY_DETECT_TIMEOUT_MS = 1000;

/**
 * Detect and optionally enable the Kitty keyboard protocol.
 *
 * @param enableIfSupported If true (default), enables the protocol when supported.
 * @returns The current Kitty keyboard state.
 */
export function useKittyKeyboardProtocol(enableIfSupported = true): KittyKeyboardState {
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const [state, setState] = useState<KittyKeyboardState>({
    supported: false,
    enabled: false,
  });

  // Refs so the `data` handler (captured once) can read the latest values
  // without re-running the effect on every state change.
  const supportedRef = useRef(false);
  const enabledRef = useRef(false);
  const settledRef = useRef(false);

  useEffect(() => {
    if (!stdout || !stdin) return;
    // Only attempt detection on terminals that are likely to support Kitty.
    // Sending `\x1B[?1u` to a non-Kitty terminal is mostly harmless but
    // can produce spurious `?1u` text in the terminal.
    if (!isKittyCapable()) {
      setState({ supported: false, enabled: false });
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;

    // P1-11 fix: Use Ink's setRawMode so escape sequences arrive intact.
    try {
      setRawMode(true);
    } catch {
      // setRawMode throws if stdin isn't a TTY (CI, pipe). Bail gracefully.
      return;
    }

    const onData = (data: string): void => {
      // P1-11 fix: Use a proper regex instead of two `includes()` checks.
      const match = KITTY_RESPONSE_RE.exec(data);
      if (!match) return;
      supportedRef.current = true;
      // If we're still within the detect window (not yet settled), enable
      // the protocol immediately. If the response is late (after settle),
      // we retroactively enable + update state so the user gets the
      // protocol even on slow terminals.
      if (!enabledRef.current && enableIfSupported) {
        try { stdout.write('\x1B[>1u'); } catch { /* ignore */ }
        enabledRef.current = true;
        setState({ supported: true, enabled: true });
      } else if (!settledRef.current) {
        setState({ supported: true, enabled: enabledRef.current });
      }
    };

    // Send the Kitty protocol query: CSI ? 1 u (get current flags).
    try { stdout.write('\x1B[?1u'); } catch { /* ignore */ }
    stdin.on('data', onData);

    // Wait for a response. If none arrives within the timeout, assume
    // not supported and settle the state.
    timeout = setTimeout(() => {
      settledRef.current = true;
      if (!supportedRef.current) {
        // P1-11 fix: do NOT write `\x1B[<1u` (pop) — we never pushed.
        setState({ supported: false, enabled: false });
      }
    }, KITTY_DETECT_TIMEOUT_MS);

    return () => {
      if (timeout) clearTimeout(timeout);
      try { stdin.off('data', onData); } catch { /* ignore */ }
      // Pop the Kitty protocol stack on unmount (restore default) —
      // ONLY if we actually enabled it.
      if (enabledRef.current) {
        try { stdout.write('\x1B[<1u'); } catch { /* ignore */ }
        enabledRef.current = false;
      }
      try { setRawMode(false); } catch { /* ignore */ }
    };
  }, [stdout, stdin, setRawMode, enableIfSupported]);

  return state;
}

/**
 * Check if the current terminal likely supports the Kitty keyboard protocol.
 * This is a heuristic based on the TERM_PROGRAM env var.
 *
 * Terminals known to support Kitty:
 *   - Kitty (kitty)
 *   - Ghostty (ghostty)
 *   - Konsole 22.04+
 *   - WezTerm (WezTerm)
 *   - foot (foot)
 *
 * P1-11 fix: Added Konsole (was mentioned in the comment but missing from
 * the list). Comparison is now case-insensitive on TERM_PROGRAM so
 * `Kitty` and `kitty` both match.
 */
export function isKittyCapable(): boolean {
  const termProgram = (process.env['TERM_PROGRAM'] ?? '').toLowerCase();
  const term = process.env['TERM'] ?? '';
  // P1-11 fix: lowercase comparison + added 'konsole'.
  const kittyTerminals = ['kitty', 'ghostty', 'wezterm', 'foot', 'konsole'];
  return kittyTerminals.includes(termProgram) || term.toLowerCase().includes('kitty');
}
