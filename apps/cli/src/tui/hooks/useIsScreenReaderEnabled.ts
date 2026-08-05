/**
 * useIsScreenReaderEnabled — React hook for screen-reader mode (T-033).
 *
 * Returns true when the user has requested screen-reader / accessibility
 * mode via any of:
 *   - `--accessibility` CLI flag
 *   - `--screen-reader` CLI flag (alias, matches gemini-cli convention)
 *   - `GOLI_CLI_ACCESSIBILITY=1` env var
 *   - `NO_COLOR` env var (industry-standard accessibility signal)
 *
 * When true, TUI components SHOULD:
 *   - Disable animations (spinners, blinking cursors, FPS overlay)
 *   - Disable scrolling regions (use full-page redraws instead)
 *   - Disable live regions (they confuse screen readers)
 *   - Replace box-drawing characters with plain text where possible
 *   - Increase color contrast (avoid dim/grey text)
 *
 * Implementation: the hook reads from `detectCapabilities()` (cached for
 * process lifetime — terminal capabilities don't change mid-process).
 * The hook subscribes to React state so a future hot-reload of the flag
 * would trigger a re-render, but in practice the flag is set once at
 * process start.
 *
 * @module tui/hooks/useIsScreenReaderEnabled
 */

import { useState, useEffect } from 'react';

import { detectCapabilities } from '../lib/capabilities.js';

/**
 * Returns true if screen-reader / accessibility mode is enabled.
 *
 * @returns boolean — true if the TUI should use the screen-reader layout.
 */
export function useIsScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => detectCapabilities().accessibility);

  useEffect(() => {
    // Re-check on mount in case the flag was set after initial detection
    // (e.g. by a slash command in a future iteration).
    setEnabled(detectCapabilities().accessibility);
  }, []);

  return enabled;
}

/**
 * Non-hook variant for use outside React components.
 *
 * @returns boolean — true if screen-reader mode is enabled.
 */
export function isScreenReaderEnabled(): boolean {
  return detectCapabilities().accessibility;
}
