/**
 * hooks/useFlickerDetector.ts — Detect React commits that overflow the terminal.
 *
 * A "flicker frame" is a render whose measured height exceeds the terminal
 * height, causing the terminal to scroll vertically on every commit. This
 * is a symptom of a layout bug that should be fixed.
 *
 * The hook runs on EVERY render (no deps array) and:
 *   1. Calls `measureElement` on the root UI ref.
 *   2. If `measurement.height > terminalHeight` AND `constrainHeight` is true,
 *      records a flicker frame via `recordFlickerFrame()`.
 *
 * When `constrainHeight === false`, the app is intentionally overflowing
 * (e.g. a fullscreen dialog), so flicker detection is suppressed.
 *
 * Activation: GOLI_TUI_DEBUG=1. Off by default; the hook short-circuits.
 *
 * @module useFlickerDetector
 */

import { type DOMElement, measureElement } from 'ink';
import { useEffect } from 'react';
import { isFlickerEnabled, recordFlickerFrame } from '../lib/flickerStore.js';

/**
 * Detect flicker frames on the root UI element.
 *
 * @param rootUiRef - A ref to the root UI element (e.g. `<Box ref={rootUiRef}>`).
 * @param terminalHeight - The current terminal height in rows.
 * @param constrainHeight - When false, suppress detection (intentional overflow).
 */
export function useFlickerDetector(
  rootUiRef: React.RefObject<DOMElement | null>,
  terminalHeight: number,
  constrainHeight: boolean = true,
): void {
  useEffect(() => {
    if (!isFlickerEnabled()) return;
    if (!rootUiRef.current) return;

    const measurement = measureElement(rootUiRef.current);
    if (measurement.height > terminalHeight) {
      // If we are not constraining the height, we are intentionally
      // overflowing the screen.
      if (!constrainHeight) return;
      recordFlickerFrame();
    }
  });
}
