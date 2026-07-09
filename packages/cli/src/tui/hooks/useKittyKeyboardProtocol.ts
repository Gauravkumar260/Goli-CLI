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
 * @module hooks/useKittyKeyboardProtocol
 */
import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

/** Kitty keyboard protocol state. */
export interface KittyKeyboardState {
  /** Whether the terminal supports the Kitty keyboard protocol. */
  supported: boolean;
  /** Whether the protocol has been enabled. */
  enabled: boolean;
}

/**
 * Detect and optionally enable the Kitty keyboard protocol.
 *
 * @param enableIfSupported If true (default), enables the protocol when supported.
 * @returns The current Kitty keyboard state.
 */
export function useKittyKeyboardProtocol(enableIfSupported = true): KittyKeyboardState {
  const { stdout } = useStdout();
  const [state, setState] = useState<KittyKeyboardState>({
    supported: false,
    enabled: false,
  });

  useEffect(() => {
    if (!stdout) return;
    const stdin = process.stdin;

    let supported = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    // Kitty protocol detection: send CSI ? 1 u (query current flags).
    // If the terminal supports Kitty, it responds with CSI ? <flags> u.
    // We set a 200ms timeout — if no response, assume not supported.
    const onData = (data: Buffer): void => {
      const str = data.toString('utf-8');
      // Kitty response: CSI ? <flags> u
      if (str.includes('\x1B[?') && str.includes('u')) {
        supported = true;
      }
    };

    if (stdin.isTTY) {
      // Send the Kitty protocol query.
      stdout.write('\x1B[?1u');
      stdin.on('data', onData);

      // Wait 200ms for a response.
      timeout = setTimeout(() => {
        if (supported && enableIfSupported) {
          // Enable Kitty keyboard protocol: CSI > 1 u (push flags).
          stdout.write('\x1B[>1u');
          setState({ supported: true, enabled: true });
        } else {
          // Not supported — clean up the query.
          stdout.write('\x1B[<1u'); // pop the query
          setState({ supported: false, enabled: false });
        }
      }, 200);
    }

    return () => {
      if (timeout) clearTimeout(timeout);
      if (stdin.isTTY) {
        stdin.off('data', onData);
        // Pop the Kitty protocol stack on unmount (restore default).
        if (supported && enableIfSupported) {
          stdout.write('\x1B[<1u');
        }
      }
    };
  }, [stdout, enableIfSupported]);

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
 */
export function isKittyCapable(): boolean {
  const termProgram = process.env['TERM_PROGRAM'] ?? '';
  const term = process.env['TERM'] ?? '';
  const kittyTerminals = ['kitty', 'ghostty', 'WezTerm', 'foot'];
  return kittyTerminals.includes(termProgram) || term.includes('kitty');
}
