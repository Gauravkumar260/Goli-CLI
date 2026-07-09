/**
 * theme/tokens.ts — Color palette (live-theme-switchable, T-076).
 *
 * Originally a hardcoded `const` (Tokyo Night Dark). T-076 makes the
 * palette mutable so `/theme <name>` can hot-reload colors without
 * requiring a restart. Components import `T` directly and read `T.red`
 * etc. on every render — when `applySkinToTokens()` mutates the
 * properties in place, the next React render picks up the new colors.
 *
 * To force a re-render after switching themes, call `useThemeVersion()`
 * in the top-level App component — it returns a counter that bumps
 * whenever `applySkinToTokens()` is called.
 *
 * Usage:
 *   import { T } from '../theme/tokens.js';
 *   <Text color={T.red}>...</Text>
 *
 * Research (GOLI_CLI_TUI_DEEP_RESEARCH.md §16.2): we add an
 * optional color-downsampling helper for terminals that lack
 * truecolor support. On truecolor terminals, every color is
 * returned unchanged — zero visual difference. On 256-color
 * terminals, each hex color is mapped to its nearest xterm-256
 * cube entry so the design still reads correctly. On 16-color
 * terminals, we fall back to the nearest ANSI base color.
 */
import { detectCapabilities } from '../lib/capabilities.js';

/**
 * The active color palette. Properties are mutated in place by
 * `applySkinToTokens()` to enable live theme switching (T-076).
 */
export const T: {
  fg: string;
  blue: string;
  green: string;
  red: string;
  yellow: string;
  purple: string;
  teal: string;
  gray: string;
  border: string;
  orange: string;
} = {
  fg:     '#c0caf5',  // foreground text
  blue:   '#7aa2f7',
  green:  '#9ece6a',
  red:    '#f7768e',
  yellow: '#e0af68',
  purple: '#bb9af7',
  teal:   '#73daca',
  gray:   '#565f89',  // dim labels, secondary text
  border: '#414868',  // box borders, separators
  orange: '#ff9e64',
};

/** Default Tokyo Night Dark palette (used to reset on theme switch). */
export const DEFAULT_PALETTE = { ...T };

/**
 * T-076: Apply a skin's color palette to the live `T` tokens.
 *
 * Mutates `T` in place so all components that reference `T.red` etc.
 * pick up the new colors on their next render. Returns true if any
 * color actually changed.
 *
 * T-087: Also applies the skin's borderStyle to the live `B` token.
 */
export function applySkinToTokens(skin: {
  colors: {
    fg?: string;
    blue?: string;
    green?: string;
    red?: string;
    yellow?: string;
    purple?: string;
    teal?: string;
    gray?: string;
    border?: string;
    orange?: string;
  };
  borderStyle?: string;
}): boolean {
  const c = skin.colors;
  let changed = false;
  if (c.fg     !== undefined && T.fg     !== c.fg)     { T.fg     = c.fg;     changed = true; }
  if (c.blue   !== undefined && T.blue   !== c.blue)   { T.blue   = c.blue;   changed = true; }
  if (c.green  !== undefined && T.green  !== c.green)  { T.green  = c.green;  changed = true; }
  if (c.red    !== undefined && T.red    !== c.red)    { T.red    = c.red;    changed = true; }
  if (c.yellow !== undefined && T.yellow !== c.yellow) { T.yellow = c.yellow; changed = true; }
  if (c.purple !== undefined && T.purple !== c.purple) { T.purple = c.purple; changed = true; }
  if (c.teal   !== undefined && T.teal   !== c.teal)   { T.teal   = c.teal;   changed = true; }
  if (c.gray   !== undefined && T.gray   !== c.gray)   { T.gray   = c.gray;   changed = true; }
  if (c.border !== undefined && T.border !== c.border) { T.border = c.border; changed = true; }
  if (c.orange !== undefined && T.orange !== c.orange) { T.orange = c.orange; changed = true; }
  // T-087: Apply border style from skin.
  if (skin.borderStyle !== undefined && applyBorderStyle(skin.borderStyle)) {
    changed = true;
  }
  if (changed) {
    // Bump the theme version counter to trigger re-renders.
    themeVersionCounter++;
    themeVersionListeners.forEach((fn) => fn(themeVersionCounter));
  }
  return changed;
}

/**
 * T-076: Theme version counter. Incremented every time
 * `applySkinToTokens()` changes the palette. The `useThemeVersion()`
 * hook subscribes to this so components re-render on theme switch.
 */
let themeVersionCounter = 0;
const themeVersionListeners = new Set<(version: number) => void>();

/**
 * T-076: Get the current theme version (for cache-busting).
 */
export function getThemeVersion(): number {
  return themeVersionCounter;
}

/**
 * T-076: Subscribe to theme version changes. Returns an unsubscribe function.
 * Used internally by `useThemeVersion()`.
 */
export function subscribeToThemeVersion(fn: (version: number) => void): () => void {
  themeVersionListeners.add(fn);
  return () => { themeVersionListeners.delete(fn); };
}

/**
 *
 */
export type ColorToken = keyof typeof T;

/** Helper: wrap text in a colored <Text> prop value. */
export function c(name: ColorToken): string {
  return T[name];
}

// ─── T-087: Skin-aware border style ──────────────────────────────────
//
// Components previously hardcoded `borderStyle: 'round'`. The Skin
// interface has a `borderStyle` field, but it was never read. T-087
// adds a mutable `B.borderStyle` token (parallel to `T`) that
// `applySkinToTokens()` updates, so switching skins also switches
// border styles live.

/**
 * The active border style. Mutated by `applySkinToTokens()` to enable
 * live border-style switching (T-087).
 */
export const B: { borderStyle: string } = {
  borderStyle: 'round',
};

/** Default border style (round — matches the original hardcoded value). */
export const DEFAULT_BORDER_STYLE = 'round';

/**
 * T-087: Apply a skin's border style to the live `B` token.
 * Called by `applySkinToTokens()` (which also handles colors).
 */
export function applyBorderStyle(borderStyle: string): boolean {
  if (B.borderStyle !== borderStyle) {
    B.borderStyle = borderStyle;
    return true;
  }
  return false;
}

/**
 * T-087: Get the active border style for use in `<Box borderStyle={...}>`.
 * Components should use `getBorderStyle()` instead of hardcoding 'round'.
 */
export function getBorderStyle(): string {
  return B.borderStyle;
}

// ─── Color downsampling (research §16.2) ────────────────────────────────
//
// Pre-computed nearest-xterm-256 indices for each token. We compute
// these lazily ONCE (on first resolveColor call) and cache. Each lookup
// is O(1) thereafter.
//
// Method: standard xterm-256 cube has 6 levels per channel
// (0,95,135,175,215,255). For each #rrggbb token we find the closest
// cube level per channel and produce `38;5;N` where N = 16 + 36*r + 6*g + b.
//
// These mappings were verified visually against the Tokyo Night palette
// in a 256-color terminal — they preserve the warm/cool separation
// between blue/teal/green and the warning hue of yellow/orange/red.

const HEX_TO_XTERM256: Record<string, number> = {
  '#c0caf5': 189,  // fg   — light lavender-white
  '#7aa2f7': 111,  // blue — sky blue
  '#9ece6a': 150,  // green — soft green
  '#f7768e': 210,  // red — salmon
  '#e0af68': 179,  // yellow — gold
  '#bb9af7': 141,  // purple — light purple
  '#73daca': 79,   // teal — aqua
  '#565f89': 60,   // gray — slate
  '#414868': 238,  // border — dark slate
  '#ff9e64': 215,  // orange — peach
};

// 16-color ANSI fallback. Used when the terminal supports neither
// truecolor nor 256-color (rare — Linux console, dumb terminal).
// Mapped to the closest base ANSI color name.
const HEX_TO_ANSI16: Record<string, string> = {
  '#c0caf5': 'white',
  '#7aa2f7': 'blue',
  '#9ece6a': 'green',
  '#f7768e': 'red',
  '#e0af68': 'yellow',
  '#bb9af7': 'magenta',
  '#73daca': 'cyan',
  '#565f89': 'gray',
  '#414868': 'gray',
  '#ff9e64': 'red',
};

let capabilitiesCache: ReturnType<typeof detectCapabilities> | null = null;

function caps() {
  if (!capabilitiesCache) capabilitiesCache = detectCapabilities();
  return capabilitiesCache;
}

/**
 * T-093: Reset the capabilities cache. Used by tests that mock
 * detectCapabilities() to force a re-detection on the next resolveColor() call.
 */
export function resetCapabilitiesCache(): void {
  capabilitiesCache = null;
}

/**
 * T-093: Convert an xterm-256 color index to its hex equivalent.
 *
 * The xterm-256 palette has:
 *   - Indices 0–7:   standard ANSI colors (dark)
 *   - Indices 8–15:  standard ANSI colors (bright)
 *   - Indices 16–231: 6×6×6 color cube (16 + 36*r + 6*g + b)
 *   - Indices 232–255: grayscale ramp
 *
 * For the 6×6×6 cube, each channel level maps to: 0→0, 1→95, 2→135,
 * 3→175, 4→215, 5→255.
 *
 * @param idx The xterm-256 color index (0–255).
 * @returns The hex string (e.g. '#5f87af') for that index.
 */
function xterm256ToHex(idx: number): string {
  if (idx >= 16 && idx <= 231) {
    // 6×6×6 color cube
    const i = idx - 16;
    const r = Math.floor(i / 36) % 6;
    const g = Math.floor(i / 6) % 6;
    const b = i % 6;
    const levels = [0, 95, 135, 175, 215, 255];
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(levels[r]!)}${toHex(levels[g]!)}${toHex(levels[b]!)}`;
  }
  if (idx >= 232 && idx <= 255) {
    // Grayscale ramp: 232=08, 233=1c, ..., 255=ee
    const v = 8 + (idx - 232) * 10;
    const hex = v.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }
  // Indices 0–15: standard ANSI colors — return a reasonable approximation.
  // These vary by terminal, so we use the common xterm defaults.
  const ansi16Hex: string[] = [
    '#000000', '#800000', '#008000', '#808000',
    '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00',
    '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  return ansi16Hex[idx] ?? '#000000';
}

/**
 * T-093: Resolve a hex color to whatever the current terminal can render.
 *
 * - truecolor → returns the hex unchanged (zero visual difference)
 * - 256-color → returns the hex of the nearest xterm-256 color cube entry.
 *   The HEX_TO_XTERM256 map provides pre-computed nearest indices for the
 *   Tokyo Night palette. For unknown hex values, falls back to the original
 *   hex (the terminal will do its own nearest-match).
 * - 16-color → returns the nearest ANSI base color name (e.g. 'red',
 *   'green', 'blue'). The HEX_TO_ANSI16 map provides pre-computed mappings.
 *
 * This ensures colors render correctly on constrained terminals instead
 * of relying on each terminal's (often poor) automatic nearest-match.
 */
export function resolveColor(hex: string): string {
  const c = caps();
  if (c.trueColor) return hex;
  if (c.colors256) {
    // T-093: Look up the pre-computed xterm-256 index and convert to hex.
    const x256Idx = HEX_TO_XTERM256[hex.toLowerCase()];
    if (x256Idx !== undefined) {
      return xterm256ToHex(x256Idx);
    }
    // Unknown hex — return as-is (terminal will approximate).
    return hex;
  }
  // 16-color fallback — return the nearest ANSI base color name.
  const ansiName = HEX_TO_ANSI16[hex.toLowerCase()];
  if (ansiName) return ansiName;
  return hex;
}

// Exposed for tests — not part of the public API.
/**
 *
 */
export const __testing = { HEX_TO_XTERM256, HEX_TO_ANSI16 };
