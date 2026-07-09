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
 * @module hooks/useMouseScroll
 */
import { useEffect, useRef } from 'react';
import { useStdout } from 'ink';

interface Props {
  /** Called when the user scrolls the mouse wheel. delta > 0 = scroll down, delta < 0 = scroll up. */
  onScroll: (delta: number) => void;
  /** Whether mouse scroll is enabled. Default: true. */
  enabled?: boolean;
}

/**
 * Enable mouse tracking and translate wheel events into scroll callbacks.
 *
 * Mouse tracking sequences:
 *   `\x1B[?1000h` — enable basic mouse tracking (button press/release)
 *   `\x1B[?1006h` — enable SGR mouse mode (precise coordinates)
 *   `\x1B[?1000l` — disable mouse tracking
 *
 * Mouse wheel events in SGR mode:
 *   Scroll up:   `\x1B[<0;col;rowM`  (button 0 + M = press)
 *   Scroll down: `\x1B[<1;col;rowM`  (button 1 + M = press)
 *
 * Note: Ink's `useInput` doesn't directly expose mouse events, so this
 * hook reads raw stdin. When mouse events arrive, it calls `onScroll`.
 */
export function useMouseScroll({ onScroll, enabled = true }: Props): void {
  const { stdout } = useStdout();
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  useEffect(() => {
    if (!enabled || !stdout) return;

    // Enable mouse tracking (SGR mode for precise coordinates).
    stdout.write('\x1B[?1000h\x1B[?1006h');

    // Read raw stdin for mouse events.
    const stdin = process.stdin;
    const onData = (data: Buffer): void => {
      const str = data.toString('utf-8');
      // SGR mouse event format: \x1B[<button;col;rowM  (M = press, m = release)
      // eslint-disable-next-line no-control-regex
      const mouseMatch = str.match(/\x1B\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouseMatch) {
        const button = parseInt(mouseMatch[1]!, 10);
        const eventType = mouseMatch[4];
        // Only handle press events (M), not release (m).
        if (eventType !== 'M') return;
        // Button 64 = scroll up, 65 = scroll down (in some terminals).
        // SGR mode: button 0 = left, 1 = middle, 2 = right.
        // For wheel: many terminals send button 64 (up) / 65 (down).
        if (button === 64) {
          onScrollRef.current(-3); // scroll up by 3 lines
        } else if (button === 65) {
          onScrollRef.current(3); // scroll down by 3 lines
        }
      }
    };

    // Only set up raw-mode listener if stdin supports it.
    if (stdin.isTTY) {
      stdin.on('data', onData);
    }

    return () => {
      // Disable mouse tracking on unmount.
      stdout.write('\x1B[?1000l\x1B[?1006l');
      if (stdin.isTTY) {
        stdin.off('data', onData);
      }
    };
  }, [enabled, stdout]);
}

/**
 * T-099: Toggle mouse mode on/off.
 * Called by the Ctrl+S keybinding (matching gemini-cli's TOGGLE_MOUSE_MODE).
 * Writes the enable/disable sequence to stdout.
 */
export function toggleMouseMode(stdout: NodeJS.WriteStream): boolean {
  // This is a stateful toggle — we'd need to track state externally.
  // For now, this is a stub that enables mouse mode.
  // A full implementation would track the current state.
  stdout.write('\x1B[?1000h\x1B[?1006h');
  return true;
}
