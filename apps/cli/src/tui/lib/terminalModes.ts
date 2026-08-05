/**
 * lib/terminalModes.ts — Comprehensive terminal mode reset on exit.
 *
 * Ported from hermes-agent (hermes-agent-main/ui-tui/src/lib/terminalModes.ts).
 *
 * Why this matters (no design change): goli-tui never enables kitty keyboard
 * flags, focus reporting, mouse tracking, or any of the modern terminal
 * modes — it only uses Ink's raw input + DEC sync output. But the user's
 * terminal may have been in those modes BEFORE `goli` launched (e.g. they
 * were running `htop` with mouse support, or `vim` with focus events). When
 * goli exits, only Ink's own modes get cleared. Anything the user had on
 * before stays on, leaving their shell in a weird state (clicking selects
 * text instead of copying, focus events fire on every keystroke, etc.).
 *
 * The `TERMINAL_MODE_RESET` sequence below matches Hermes's: it explicitly
 * disables every mode goli didn't enable but the terminal might have on.
 * `resetTerminalModes()` writes it once, on exit, using a single
 * `writeSync` syscall so the terminal can't be left half-reset mid-stream.
 */
import { writeSync } from 'node:fs';

/**
 * The combined reset sequence. Order is significant: kitty keyboard flags
 * (CSI >u) MUST come before CSI ?u clears, and DEC modes must precede the
 * SGR/UTF-8/legacy mouse-mode disables (some terminals refuse the disabled
 * if you send them in the wrong order). Mirrors what xterm, kitty, wezterm,
 * and alacritty docs prescribe for safe-state recovery.
 */
export const TERMINAL_MODE_RESET =
  '\x1b[0\'z' + // DEC locator reporting
  '\x1b[0\'{' + // selectable locator events
  '\x1b[?2029l' + // passive mouse
  '\x1b[?1016l' + // SGR-pixels mouse
  '\x1b[?1015l' + // urxvt decimal mouse
  '\x1b[?1006l' + // SGR mouse
  '\x1b[?1005l' + // UTF-8 extended mouse
  '\x1b[?1003l' + // any-motion mouse
  '\x1b[?1002l' + // button-motion mouse
  '\x1b[?1001l' + // highlight mouse
  '\x1b[?1000l' + // click mouse
  '\x1b[?9l' + // X10 mouse
  '\x1b[?1004l' + // focus events
  '\x1b[?2004l' + // bracketed paste
  '\x1b[?1049l' + // alternate screen
  '\x1b[<u' + // kitty keyboard
  '\x1b[>4m' + // modifyOtherKeys
  '\x1b[0m' + // attributes
  '\x1b[?25h'; // cursor visible

type ResettableStream = Pick<NodeJS.WriteStream, 'isTTY' | 'write'> & {
  fd?: number;
};

/**
 * Write the reset sequence to a TTY stream.
 *
 * Returns:
 *   - true:  the reset was issued (or attempted and accepted).
 *   - false: stream isn't a TTY or write failed.
 *
 * Uses `writeSync(fd, ...)` if the stream exposes `fd` (the fast path on
 * Linux/macOS — one syscall, atomic from the terminal's point of view).
 * Falls back to `stream.write(...)` for mocked streams in tests.
 */
export function resetTerminalModes(stream: ResettableStream = process.stdout): boolean {
  if (!stream.isTTY) return false;

  const fd = typeof stream.fd === 'number'
    ? stream.fd
    : stream === process.stdout
      ? 1
      : undefined;

  if (fd !== undefined) {
    try {
      writeSync(fd, TERMINAL_MODE_RESET);
      return true;
    } catch {
      // Fall through to stream.write for mocked or unusual TTY streams.
    }
  }

  try {
    stream.write(TERMINAL_MODE_RESET);
    return true;
  } catch {
    return false;
  }
}
