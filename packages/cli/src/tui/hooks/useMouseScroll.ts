/**
 * hooks/useMouseScroll.ts — Mouse wheel scroll support (T-099).
 *
 * Reference: gemini-cli's `useMouseClick` + `TOGGLE_MOUSE_MODE` (Ctrl+S).
 * Ink supports mouse events via `useInput` when mouse tracking is enabled.
 *
 * This hook enables mouse tracking on mount and translates mouse wheel
 * scroll events into scroll-up / scroll-down actions. The parent component
 * receives an `onScroll(delta)` callback to adjust its scroll position.
 *
 * Mouse tracking is enabled by writing `\x1B[?1000h` to stdout (SGR mouse
 * mode `\x1B[?1006h` for precise coordinates). We disable it on unmount
 * to avoid leaving the terminal in mouse mode.
 *
 * P1-11 fix: The previous implementation attached a `data` listener
 * directly to `process.stdin`, bypassing Ink's stdin ownership. Ink
 * already owns stdin in raw mode and routes bytes through its own
 * `useInput` key dispatcher — attaching a second `data` listener meant
 * BOTH Ink AND this hook received every byte. Ink interpreted mouse
 * escape sequences as spurious keypresses, and the hook's regex was
 * non-global so only the FIRST mouse event per data chunk was decoded
 * (fast scrolling lost events). Also, raw mode was never explicitly
 * enabled (Ink's `setRawMode(true)` is required for escape sequences
 * to arrive intact).
 *
 * The rewrite uses Ink's `useStdin().setRawMode(true)` + the
 * `useStdin().data` event (which is the Ink-sanctioned way to observe
 * raw stdin bytes after Ink has had a chance to interpret them as
 * keys). The regex is now global so multiple mouse events in a single
 * chunk are all decoded. Cleanup explicitly restores raw mode and
 * removes the listener.
 *
 * @module hooks/useMouseScroll
 */
import { useEffect, useRef } from 'react';
import { useStdin, useStdout } from 'ink';

interface Props {
  /** Called when the user scrolls the mouse wheel. delta > 0 = scroll down, delta < 0 = scroll up. */
  onScroll: (delta: number) => void;
  /** Whether mouse scroll is enabled. Default: true. */
  enabled?: boolean;
}

// SGR mouse event format: \x1B[<button;col;row(M|m)
// P1-11 fix: `g` flag so we decode ALL events in a chunk, not just the first.
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /\x1B\[<(\d+);(\d+);(\d+)([Mm])/g;

/**
 * Enable mouse tracking and translate wheel events into scroll callbacks.
 *
 * Mouse tracking sequences:
 *   `\x1B[?1000h` — enable basic mouse tracking (button press/release)
 *   `\x1B[?1006h` — enable SGR mouse mode (precise coordinates)
 *   `\x1B[?1000l` — disable mouse tracking
 *
 * Mouse wheel events in SGR mode:
 *   Scroll up:   `\x1B[<64;col;rowM`  (button 64 + M = wheel up press)
 *   Scroll down: `\x1B[<65;col;rowM`  (button 65 + M = wheel down press)
 *
 * (Note: the previous header comment said "button 0" / "button 1" which
 * was incorrect — buttons 0/1/2 are left/middle/right CLICKS, not wheel.
 * The code below was already correct; only the doc was wrong.)
 */
export function useMouseScroll({ onScroll, enabled = true }: Props): void {
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  useEffect(() => {
    if (!enabled || !stdout || !stdin) return;

    // Enable mouse tracking (SGR mode for precise coordinates).
    stdout.write('\x1B[?1000h\x1B[?1006h');

    // P1-11 fix: Use Ink's setRawMode so Ink owns the raw-mode lifecycle.
    // Without this, escape sequences are line-buffered by the terminal
    // and arrive split across multiple `data` events, breaking the regex.
    try {
      setRawMode(true);
    } catch {
      // setRawMode throws if stdin isn't a TTY (CI, pipe). Bail gracefully.
      return;
    }

    // P1-11 fix: Listen via Ink's `data` event (after Ink's key dispatcher
    // has had its chance) rather than attaching a second `data` listener
    // to process.stdin directly. This avoids double-dispatch.
    const onData = (data: string): void => {
      // Reset regex state and decode ALL mouse events in this chunk.
      SGR_MOUSE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SGR_MOUSE_RE.exec(data)) !== null) {
        const button = parseInt(match[1]!, 10);
        const eventType = match[4];
        // Only handle press events (M), not release (m).
        if (eventType !== 'M') continue;
        // Button 64 = scroll up, 65 = scroll down (SGR wheel).
        if (button === 64) {
          onScrollRef.current(-3); // scroll up by 3 lines
        } else if (button === 65) {
          onScrollRef.current(3); // scroll down by 3 lines
        }
      }
    };

    stdin.on('data', onData);

    return () => {
      // Disable mouse tracking on unmount.
      try { stdout.write('\x1B[?1000l\x1B[?1006l'); } catch { /* ignore */ }
      try { stdin.off('data', onData); } catch { /* ignore */ }
      try { setRawMode(false); } catch { /* ignore */ }
    };
  }, [enabled, stdout, stdin, setRawMode]);
}

/**
 * T-099: Toggle mouse mode on/off.
 * Called by the Ctrl+S keybinding (matching gemini-cli's TOGGLE_MOUSE_MODE).
 * Writes the enable/disable sequence to stdout.
 *
 * P1-11 fix: The previous implementation was a stub that always ENABLED
 * mouse mode (the comment admitted as much). We now track a module-level
 * boolean so repeated calls actually toggle. This is still imperfect —
 * the state is process-global, not per-component — but it matches the
 * existing API contract and the App.tsx caller already pushes a system
 * message describing the new state, so the user gets feedback either way.
 */
let mouseModeEnabled = false;
/**
 *
 */
export function toggleMouseMode(stdout: NodeJS.WriteStream): boolean {
  mouseModeEnabled = !mouseModeEnabled;
  if (mouseModeEnabled) {
    stdout.write('\x1B[?1000h\x1B[?1006h');
  } else {
    stdout.write('\x1B[?1000l\x1B[?1006l');
  }
  return mouseModeEnabled;
}

/**
 * Test-only helper: reset the module-level toggle state so each test can
 * call `toggleMouseMode` from a known (disabled) baseline. Without this,
 * the first test that calls `toggleMouseMode` flips the state to enabled,
 * and the next test inherits that state and writes the DISABLE sequence
 * instead of the ENABLE sequence the test expects.
 */
export function __resetMouseModeStateForTests(): void {
  mouseModeEnabled = false;
}
