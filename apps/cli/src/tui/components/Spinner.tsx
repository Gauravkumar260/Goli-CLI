/**
 * components/Spinner.tsx — Animated spinner with multiple styles (T-041 + T-055).
 *
 * T-041 (loop run 4): closes a UI gap vs gemini-cli, which has a
 * GeminiSpinner.tsx with animated gradient spinners + CliSpinner.tsx.
 *
 * T-055 (loop run 6, iter 3): adds screen-reader fallback (altText),
 * gradient color cycling, and StreamingState awareness. Closes the
 * a11y gap where the spinner animated even in screen-reader mode
 * (causing screen readers to announce every frame change).
 *
 * Styles:
 *   - dots:    ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏  (braille dots — default)
 *   - line:    | / - \                        (classic Unix)
 *   - arrow:   ← ↖ ↑ ↗ → ↘ ↓ ↙              (clockwise arrow)
 *   - bounce:  ⠁ ⠂ ⠄ ⠂                      (bouncing bar)
 *   - triangle: ▖ ▘ ▝ ▗                    (rotating triangle)
 *
 * Gradient:
 *   - When `gradient=true`, the color cycles through 5 brand colors
 *     (purple/blue/teal/green/yellow) at each frame, mirroring gemini-cli's
 *     Google-brand gradient spinner (via tinygradient there; here we use a
 *     precomputed palette to avoid the extra dependency).
 *
 * Screen-reader fallback:
 *   - When `altText` is provided AND `useIsScreenReaderEnabled()` returns
 *     true, the spinner renders the static altText (no animation, no frame
 *     cycling). This prevents screen readers from announcing "⠋ ⠙ ⠹ ⠸..."
 *     every 100ms.
 *
 * Usage:
 *   <Spinner style="dots" />
 *   <Spinner style="line" color={T.yellow} />
 *   <Spinner gradient label="Working" />
 *   <Spinner altText="Loading (please wait)" label="Working" />
 *
 * Performance: uses setInterval at 100ms; cleared on unmount. The frame
 * lookup is O(1) via array index modulo length. In SR mode, the interval
 * is never set (zero CPU cost).
 */
import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { T } from '../theme/tokens.js';
import { useIsScreenReaderEnabled } from '../hooks/useIsScreenReaderEnabled.js';

/** Available spinner styles. */
export type SpinnerStyle =
  | 'dots' | 'line' | 'arrow' | 'bounce' | 'triangle'
  // T-088: Kawaii spinners inspired by Hermes' KawaiiSpinner (agent/display.py).
  // Each is a sequence of unicode faces/glyphs that cycle to give the agent
  // a friendly, personable feel while waiting.
  | 'kawaii'      // (｡◕‿◕｡) → (◕‿◕✿) → ٩(◕‿◕｡)۶ → ...
  | 'moon'        // 🌑 🌒 🌓 🌔 🌕 🌖 🌗 🌘
  | 'pulse'       // ◉ ◯ ◉ ◯ (heartbeat)
  | 'star'        // ✶ ✵ ✸ ✹ ✺ (rotating star)
  | 'orbit';      // ◠ ◡ (eye orbit)

/** Frame sequences for each spinner style. */
const SPINNER_FRAMES: Record<SpinnerStyle, readonly string[]> = {
  dots:     ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line:     ['|', '/', '-', '\\'],
  arrow:    ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bounce:   ['⠁', '⠂', '⠄', '⠂'],
  triangle: ['▖', '▘', '▝', '▗'],
  // T-088: Kawaii spinner frames — Hermes-style waiting faces.
  kawaii:   ['(｡◕‿◕｡)', '(◕‿◕✿)', '٩(◕‿◕｡)۶', '(✿◕‿◕)', '(｡♥‿♥｡)', '(◕‿◕)❤'],
  moon:     ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  pulse:    ['◉', '◯', '◉', '◯'],
  star:     ['✶', '✵', '✸', '✹', '✺', '✹', '✸', '✵'],
  orbit:    ['◠', '◡', '◠', '◡'],
} as const;

/** Default spinner style (matches gemini-cli's braille dots). */
export const DEFAULT_SPINNER_STYLE: SpinnerStyle = 'dots';

/** Default frame interval in milliseconds. */
export const SPINNER_INTERVAL_MS = 100;

/**
 * T-055: Gradient palette for the brand-color cycling spinner.
 * 5 colors cycled in order. Mirrors gemini-cli's Google-brand gradient
 * (purple/blue/cyan/green/yellow/red via tinygradient). We precompute
 * the palette to avoid the extra dependency.
 */
export const GRADIENT_PALETTE: readonly string[] = [
  T.purple,  // #bb9af7
  T.blue,    // #7aa2f7
  T.teal,    // #73daca
  T.green,   // #9ece6a
  T.yellow,  // #e0af68
] as const;

interface Props {
  /** Spinner style. Defaults to 'dots'. */
  style?: SpinnerStyle;
  /** Color token (hex string). Defaults to T.yellow. Ignored when gradient=true. */
  color?: string;
  /** Optional label text rendered after the spinner. */
  label?: string;
  /** Frame interval in ms. Defaults to 100. */
  intervalMs?: number;
  /**
   * T-055: When true, the spinner color cycles through GRADIENT_PALETTE
   * at each frame (brand-gradient effect, mirroring gemini-cli).
   */
  gradient?: boolean;
  /**
   * T-055: Static text rendered INSTEAD of the animated spinner when
   * screen-reader mode is enabled. Prevents AT from announcing every
   * frame change. If omitted, the spinner renders nothing in SR mode
   * (the label still renders).
   */
  altText?: string;
}

/**
 * Animated spinner. Cycles through the frame sequence for the given style
 * at the given interval. Renders `<frame> <label>` if a label is provided,
 * or just `<frame>` otherwise.
 *
 * In screen-reader mode (T-055): if `altText` is provided, renders
 * `<altText> <label>` with no animation. If `altText` is omitted, renders
 * just `<label>` (no frame). The interval is never set in SR mode.
 *
 * The spinner auto-stops when unmounted (clearInterval in the cleanup).
 */
export function Spinner({
  style = DEFAULT_SPINNER_STYLE,
  color = T.yellow,
  label,
  intervalMs = SPINNER_INTERVAL_MS,
  gradient = false,
  altText,
}: Props): React.ReactElement {
  const frames = SPINNER_FRAMES[style];
  const [frameIdx, setFrameIdx] = useState(0);
  const srEnabled = useIsScreenReaderEnabled();

  useEffect(() => {
    // T-055: skip the interval entirely in screen-reader mode (zero CPU).
    if (srEnabled) return;
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [frames.length, intervalMs, srEnabled]);

  // T-055: screen-reader fallback.
  if (srEnabled) {
    return (
      <Text bold>
        {altText ? `${altText}${label ? ' ' : ''}` : ''}
        {label ?? ''}
      </Text>
    );
  }

  const frame = frames[frameIdx] ?? frames[0]!;
  const frameColor = gradient
    ? GRADIENT_PALETTE[frameIdx % GRADIENT_PALETTE.length]!
    : color;

  return (
    <Text color={frameColor}>
      {frame}
      {label ? ` ${label}` : ''}
    </Text>
  );
}

/**
 * Get the frame sequence for a spinner style.
 * Exposed for testing — verifies each style has the expected frames.
 */
export function getSpinnerFrames(style: SpinnerStyle): readonly string[] {
  return SPINNER_FRAMES[style];
}

/** List all available spinner styles. */
export function getSpinnerStyles(): readonly SpinnerStyle[] {
  return Object.keys(SPINNER_FRAMES) as SpinnerStyle[];
}
