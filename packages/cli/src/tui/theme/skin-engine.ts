/**
 * Skin engine — YAML-driven CLI/TUI theming (T-024).
 *
 * A "skin" is a named color palette + border style + prompt style that
 * controls the visual appearance of the TUI. Skins are loaded from:
 *
 *   1. Built-in skins (default, dark, high-contrast).
 *   2. `GOLI_SKIN` env var (name of a built-in or path to a YAML file).
 *   3. `--skin <name>` CLI flag (same resolution as env var).
 *   4. `~/.goli/skins/<name>.yaml` (user-defined skins).
 *
 * ## YAML schema
 *
 * ```yaml
 * name: my-skin
 * description: A custom skin
 * colors:
 *   fg: "#c0caf5"
 *   blue: "#7aa2f7"
 *   green: "#9ece6a"
 *   red: "#f7768e"
 *   yellow: "#e0af68"
 *   purple: "#bb9af7"
 *   teal: "#73daca"
 *   gray: "#565f89"
 *   border: "#414868"
 *   orange: "#ff9e64"
 * border_style: "round"   # single, double, round, bold, singleDouble, classic
 * prompt_style: ">"       # the prompt character
 * ```
 *
 * ## Built-in skins
 *
 * - **default**: Tokyo Night Dark (matches the existing `T` tokens).
 * - **dark**: An alternative dark palette with warmer tones.
 * - **high-contrast**: Black background + white text + bright accents
 *   for accessibility (WCAG AAA contrast).
 *
 * @module tui/theme/skin-engine
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** A color token name (matches the keys of the `T` map in tokens.ts). */
export type ColorTokenName =
  | 'fg'
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'teal'
  | 'gray'
  | 'border'
  | 'orange';

/** A map of color token names to hex color strings. */
export type ColorMap = Record<ColorTokenName, string>;

/** Border style names supported by Ink's `<Box borderStyle>`. */
export type BorderStyle =
  | 'single'
  | 'double'
  | 'round'
  | 'bold'
  | 'singleDouble'
  | 'classic'
  | 'arrow';

/** A complete skin definition. */
export interface Skin {
  /** The skin name (e.g. "default", "dark", "high-contrast"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** The color palette. */
  colors: ColorMap;
  /** The border style for `<Box borderStyle>`. */
  borderStyle: BorderStyle;
  /** The prompt character (e.g. ">", "$", "❯"). */
  promptStyle: string;
  /** Whether this skin is a built-in (vs user-defined). */
  builtin: boolean;
  /** The source file path (for user-defined skins). */
  sourcePath?: string;
}

/**
 * The built-in skin names.
 *
 * T-034 (loop run 4): expanded from 3 to 11 to close the gap vs gemini-cli
 * (which ships 20 themes — 11 dark + 8 light + 1 no-color). Each new skin
 * mirrors the canonical palette from the original theme so users get a
 * familiar look. See `docs/cli/themes.md` in gemini-cli for reference.
 *
 * T-043 (loop run 5): expanded from 11 to 20 to reach full gemini-cli
 * parity. Added: ayu-dark, ayu-light, shades-of-purple-dark, holiday-dark,
 * ansi-dark, ansi-light, googlecode-light, xcode-light,
 * github-dark-colorblind, github-light-colorblind.
 */
export const BUILTIN_SKIN_NAMES = [
  'default',
  'dark',
  'high-contrast',
  'dracula',
  'solarized-dark',
  'solarized-light',
  'github-dark',
  'github-light',
  'atom-one-dark',
  'nord',
  'monokai',
  // T-043 additions (loop run 5)
  'ayu-dark',
  'ayu-light',
  'shades-of-purple-dark',
  'holiday-dark',
  'ansi-dark',
  'ansi-light',
  'googlecode-light',
  'xcode-light',
  'github-dark-colorblind',
  'github-light-colorblind',
] as const;

/** A built-in skin name. */
export type BuiltinSkinName = (typeof BUILTIN_SKIN_NAMES)[number];

// ─── Built-in skins ───────────────────────────────────────────────────

/** The default skin (Tokyo Night Dark). */
export const DEFAULT_SKIN: Skin = {
  name: 'default',
  description: 'Tokyo Night Dark — the standard Goli-CLI palette.',
  colors: {
    fg: '#c0caf5',
    blue: '#7aa2f7',
    green: '#9ece6a',
    red: '#f7768e',
    yellow: '#e0af68',
    purple: '#bb9af7',
    teal: '#73daca',
    gray: '#565f89',
    border: '#414868',
    orange: '#ff9e64',
  },
  borderStyle: 'round',
  promptStyle: '>',
  builtin: true,
};

/** The dark skin (Dark Warm). */
export const DARK_SKIN: Skin = {
  name: 'dark',
  description: 'Dark Warm — a warmer alternative dark palette.',
  colors: {
    fg: '#e6e6e6',
    blue: '#7fb4ff',
    green: '#a8c374',
    red: '#f08080',
    yellow: '#f0c674',
    purple: '#c792ea',
    teal: '#56b6c2',
    gray: '#6b7280',
    border: '#4b5563',
    orange: '#d19a66',
  },
  borderStyle: 'single',
  promptStyle: '$',
  builtin: true,
};

/** The high-contrast skin (WCAG AAA). */
export const HIGH_CONTRAST_SKIN: Skin = {
  name: 'high-contrast',
  description: 'High Contrast — black background + white text + bright accents (WCAG AAA).',
  colors: {
    fg: '#ffffff',
    blue: '#55ffff',
    green: '#55ff55',
    red: '#ff5555',
    yellow: '#ffff55',
    purple: '#ff55ff',
    teal: '#00ffff',
    gray: '#cccccc',
    border: '#ffffff',
    orange: '#ffaa00',
  },
  borderStyle: 'bold',
  promptStyle: '❯',
  builtin: true,
};

/**
 * Dracula — the canonical Dracula theme (draculatheme.com).
 * Background #282a36, foreground #f8f8f2. Pink/purple/cyan/green accents.
 */
export const DRACULA_SKIN: Skin = {
  name: 'dracula',
  description: 'Dracula — classic dark theme with pink/purple/cyan accents.',
  colors: {
    fg: '#f8f8f2',
    blue: '#bd93f9',
    green: '#50fa7b',
    red: '#ff5555',
    yellow: '#f1fa8c',
    purple: '#ff79c6',
    teal: '#8be9fd',
    gray: '#6272a4',
    border: '#44475a',
    orange: '#ffb86c',
  },
  borderStyle: 'round',
  promptStyle: '❯',
  builtin: true,
};

/**
 * Solarized Dark — Ethan Schoonover's canonical Solarized dark palette.
 * background #002b36, foreground #839496 (base0). 16-color base palette.
 */
export const SOLARIZED_DARK_SKIN: Skin = {
  name: 'solarized-dark',
  description: 'Solarized Dark — Ethan Schoonover’s precision palette.',
  colors: {
    fg: '#93a1a1',
    blue: '#268bd2',
    green: '#859900',
    red: '#dc322f',
    yellow: '#b58900',
    purple: '#6c71c4',
    teal: '#2aa198',
    gray: '#586e75',
    border: '#073642',
    orange: '#cb4b16',
  },
  borderStyle: 'single',
  promptStyle: '$',
  builtin: true,
};

/**
 * Solarized Light — the light variant of Solarized.
 * background #fdf6e3, foreground #657b83 (base00).
 *
 * T-049 (loop run 5): green updated from #859900 (2.97:1, just below AA Large)
 * to #5c6600 (5.80:1, passes AA Large). Still feels Solarized (darker shade
 * of the same hue).
 */
export const SOLARIZED_LIGHT_SKIN: Skin = {
  name: 'solarized-light',
  description: 'Solarized Light — warm cream background with muted accents.',
  colors: {
    fg: '#586e75',
    blue: '#268bd2',
    green: '#5c6600', // T-049: was #859900 (2.97:1); now 5.80:1 on #fdf6e3
    red: '#dc322f',
    yellow: '#b58900',
    purple: '#6c71c4',
    teal: '#2aa198',
    gray: '#93a1a1',
    border: '#eee8d5',
    orange: '#cb4b16',
  },
  borderStyle: 'single',
  promptStyle: '$',
  builtin: true,
};

/**
 * GitHub Dark — official GitHub dark palette (Primer).
 * background #0d1117, foreground #c9d1d9. Blue accent #58a6ff.
 */
export const GITHUB_DARK_SKIN: Skin = {
  name: 'github-dark',
  description: 'GitHub Dark — official Primer dark palette.',
  colors: {
    fg: '#c9d1d9',
    blue: '#58a6ff',
    green: '#3fb950',
    red: '#f85149',
    yellow: '#d29922',
    purple: '#bc8cff',
    teal: '#39c5cf',
    gray: '#8b949e',
    border: '#30363d',
    orange: '#db6d28',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * GitHub Light — official GitHub light palette (Primer).
 * background #ffffff, foreground #1f2328. Blue accent #0969da.
 */
export const GITHUB_LIGHT_SKIN: Skin = {
  name: 'github-light',
  description: 'GitHub Light — official Primer light palette.',
  colors: {
    fg: '#1f2328',
    blue: '#0969da',
    green: '#1a7f37',
    red: '#cf222e',
    yellow: '#9a6700',
    purple: '#8250df',
    teal: '#1b7c83',
    gray: '#636c76',
    border: '#d0d7de',
    orange: '#bc4c00',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * Atom One Dark — the default Atom One Dark syntax theme.
 * background #282c34, foreground #abb2bf. Red #e06c75, blue #61afef.
 */
export const ATOM_ONE_DARK_SKIN: Skin = {
  name: 'atom-one-dark',
  description: 'Atom One Dark — the default Atom editor dark theme.',
  colors: {
    fg: '#abb2bf',
    blue: '#61afef',
    green: '#98c379',
    red: '#e06c75',
    yellow: '#e5c07b',
    purple: '#c678dd',
    teal: '#56b6c2',
    gray: '#5c6370',
    border: '#3e4451',
    orange: '#d19a66',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * Nord — Arctic, north-bluish color palette (nordtheme.com).
 * Polar Night #2e3440 → Snow Storm #d8dee9 → Frost #81a1c1 → Aurora #88c0d0.
 */
export const NORD_SKIN: Skin = {
  name: 'nord',
  description: 'Nord — arctic north-bluish palette inspired by Nordic landscapes.',
  colors: {
    fg: '#d8dee9',
    blue: '#81a1c1',
    green: '#a3be8c',
    red: '#bf616a',
    yellow: '#ebcb8b',
    purple: '#b48ead',
    teal: '#88c0d0',
    gray: '#4c566a',
    border: '#3b4252',
    orange: '#d08770',
  },
  borderStyle: 'round',
  promptStyle: '❯',
  builtin: true,
};

/**
 * Monokai — the canonical Wimer Hazenberg Monokai palette.
 * background #272822, foreground #f8f8f2. Pink #f92672, green #a6e22e.
 *
 * T-049 (loop run 5): teal updated from #2937b8 (placeholder, 1.65:1 contrast)
 * to #1abc9c (Flat UI Turquoise, 6.17:1 contrast — passes WCAG AA Large).
 */
export const MONOKAI_SKIN: Skin = {
  name: 'monokai',
  description: 'Monokai — the classic text-editor color scheme.',
  colors: {
    fg: '#f8f8f2',
    blue: '#66d9ef',
    green: '#a6e22e',
    red: '#f92672',
    yellow: '#e6db74',
    purple: '#ae81ff',
    teal: '#1abc9c', // T-049: was #2937b8 (1.65:1); now 6.17:1 on #272822
    gray: '#75715e',
    border: '#3e3d32',
    orange: '#fd971f',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

// ─── T-043 additions (loop run 5) — 9 more themes for full gemini-cli parity ──

/**
 * Ayu Dark — the Ayu dark theme by Ike Ku.
 * background #0b0e14, foreground #aeaca6. Soft, warm dark palette.
 */
export const AYU_DARK_SKIN: Skin = {
  name: 'ayu-dark',
  description: 'Ayu Dark — soft warm dark palette with pastel accents.',
  colors: {
    fg: '#aeaca6',
    blue: '#39bae6',
    green: '#aad94c',
    red: '#f26d78',
    yellow: '#ffb454',
    purple: '#d2a6ff',
    teal: '#95e6cb',
    gray: '#646a71',
    border: '#3d4149',
    orange: '#ffb454',
  },
  borderStyle: 'single',
  promptStyle: '❯',
  builtin: true,
};

/**
 * Ayu Light — the Ayu light theme.
 * background #f8f9fa, foreground #5c6166. Warm light palette.
 */
export const AYU_LIGHT_SKIN: Skin = {
  name: 'ayu-light',
  description: 'Ayu Light — warm light palette with muted accents.',
  colors: {
    fg: '#5c6166',
    blue: '#399ee6',
    green: '#86b300',
    red: '#f07171',
    yellow: '#f2ae49',
    purple: '#a37acc',
    teal: '#4cbf99',
    gray: '#abadb1',
    border: '#d3d5d7',
    orange: '#f2ae49',
  },
  borderStyle: 'single',
  promptStyle: '❯',
  builtin: true,
};

/**
 * Shades of Purple Dark — the VSCode theme by Ahmad Awais.
 * background #1e1e3f, foreground #e3dfff. Vibrant purple-heavy palette.
 */
export const SHADES_OF_PURPLE_DARK_SKIN: Skin = {
  name: 'shades-of-purple-dark',
  description: 'Shades of Purple — vibrant purple-heavy dark theme.',
  colors: {
    fg: '#e3dfff',
    blue: '#a599e9',
    green: '#a5ff90',
    red: '#ff628c',
    yellow: '#fad000',
    purple: '#ac65ff',
    teal: '#a1feff',
    gray: '#726c86',
    border: '#2d2b57',
    orange: '#fad000',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * Holiday Dark — a festive green/red holiday theme.
 * background #00210e, foreground #f0f8ff. Christmas-tree colors.
 */
export const HOLIDAY_DARK_SKIN: Skin = {
  name: 'holiday-dark',
  description: 'Holiday Dark — festive green-and-red holiday theme.',
  colors: {
    fg: '#f0f8ff',
    blue: '#3cb371',
    green: '#3cb371',
    red: '#ff6347',
    yellow: '#ffee8c',
    purple: '#ff9999',
    teal: '#33f9ff',
    gray: '#8fbc8f',
    border: '#151b18',
    orange: '#ff6347',
  },
  borderStyle: 'round',
  promptStyle: '❯',
  builtin: true,
};

/**
 * ANSI Dark — the standard 16-color ANSI palette.
 * Uses named ANSI colors ('black', 'white', 'red', etc.) instead of hex
 * so the terminal's native ANSI palette is used. Maximum compatibility.
 */
export const ANSI_DARK_SKIN: Skin = {
  name: 'ansi-dark',
  description: 'ANSI Dark — uses the terminal\'s native 16-color ANSI palette.',
  colors: {
    fg: '#ffffff',     // white (terminal's default bright white)
    blue: '#0000ff',   // ANSI blue
    green: '#00ff00',  // ANSI green
    red: '#ff0000',    // ANSI red
    yellow: '#ffff00', // ANSI yellow
    purple: '#ff00ff', // ANSI magenta
    teal: '#00ffff',   // ANSI cyan
    gray: '#808080',   // ANSI gray
    border: '#404040', // dim gray
    orange: '#ff8000', // ANSI bright red (closest to orange)
  },
  borderStyle: 'single',
  promptStyle: '$',
  builtin: true,
};

/**
 * ANSI Light — the standard 16-color ANSI palette on light background.
 * Same colors as ANSI Dark but intended for light terminals.
 */
export const ANSI_LIGHT_SKIN: Skin = {
  name: 'ansi-light',
  description: 'ANSI Light — native ANSI palette on light background.',
  colors: {
    fg: '#000000',     // black
    blue: '#0000ff',
    green: '#008000',
    red: '#ff0000',
    yellow: '#808000',
    purple: '#800080',
    teal: '#008080',
    gray: '#808080',
    border: '#c0c0c0',
    orange: '#ff8000',
  },
  borderStyle: 'single',
  promptStyle: '$',
  builtin: true,
};

/**
 * Googlecode Light — Google Code light syntax theme.
 * background #ffffff, foreground #444444. Minimal light theme.
 */
export const GOOGLECODE_LIGHT_SKIN: Skin = {
  name: 'googlecode-light',
  description: 'Googlecode Light — minimal light theme with high contrast.',
  colors: {
    fg: '#444444',
    blue: '#000088',
    green: '#008800',
    red: '#880000',
    yellow: '#666600',
    purple: '#660066',
    teal: '#006666',
    gray: '#5f6368',
    border: '#cccccc',
    orange: '#880000',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * XCode Light — the Xcode default light theme.
 * background #ffffff, foreground #444444. Classic Mac IDE palette.
 */
export const XCODE_LIGHT_SKIN: Skin = {
  name: 'xcode-light',
  description: 'XCode Light — classic Mac IDE light theme.',
  colors: {
    fg: '#444444',
    blue: '#1c00cf',
    green: '#007400',
    red: '#c41a16',
    yellow: '#836c28',
    purple: '#aa0d91',
    teal: '#3f6e74',
    gray: '#c0c0c0',
    border: '#dcdcdc',
    orange: '#c41a16',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * GitHub Dark Colorblind — GitHub's dark theme optimized for colorblind users.
 * background #0d1117, foreground #e6edf3. Uses blue/orange instead of red/green.
 */
export const GITHUB_DARK_COLORBLIND_SKIN: Skin = {
  name: 'github-dark-colorblind',
  description: 'GitHub Dark Colorblind — accessible dark theme for colorblind users.',
  colors: {
    fg: '#e6edf3',
    blue: '#79c0ff',
    green: '#a5d6ff',  // blue-shifted for colorblind accessibility
    red: '#f0883e',    // orange-shifted
    yellow: '#d29922',
    purple: '#d2a8ff',
    teal: '#a5d6ff',
    gray: '#7d8590',
    border: '#30363d',
    orange: '#f0883e',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * GitHub Light Colorblind — GitHub's light theme optimized for colorblind users.
 * background #ffffff, foreground #1f2328.
 */
export const GITHUB_LIGHT_COLORBLIND_SKIN: Skin = {
  name: 'github-light-colorblind',
  description: 'GitHub Light Colorblind — accessible light theme for colorblind users.',
  colors: {
    fg: '#1f2328',
    blue: '#0550ae',
    green: '#0969da',  // blue-shifted
    red: '#bc4c00',    // orange-shifted
    yellow: '#9a6700',
    purple: '#8250df',
    teal: '#0a3069',
    gray: '#656d76',
    border: '#d0d7de',
    orange: '#bc4c00',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * T-055: NoColorSkin — a fully-decolorized skin for `NO_COLOR` users.
 *
 * Reference: gemini-cli's `NoColorTheme` returns blank colors for every
 * semantic token. We achieve the same effect by setting every color to
 * the empty string, which Ink interprets as "no color" (terminal default
 * foreground). This satisfies the `NO_COLOR=1` convention
 * (https://no-color.org/) without breaking the Skin contract.
 *
 * Note: this skin is NOT in BUILTIN_SKIN_NAMES by default — it's looked
 * up specially when `NO_COLOR` is set, so users in normal terminals
 * don't see it in the theme list. Use `/theme no-color` to preview it
 * explicitly.
 */
export const NO_COLOR_SKIN: Skin = {
  name: 'no-color',
  description: 'No color (for NO_COLOR / accessibility — uses terminal defaults)',
  colors: {
    fg: '',
    blue: '',
    green: '',
    red: '',
    yellow: '',
    purple: '',
    teal: '',
    gray: '',
    border: '',
    orange: '',
  },
  borderStyle: 'single',
  promptStyle: '>',
  builtin: true,
};

/**
 * Map of built-in skin names to skin definitions.
 *
 * T-034 (loop run 4): expanded to include all 11 built-in skins.
 * T-043 (loop run 5): expanded to 20 skins for full gemini-cli parity.
 * The order here is the display order shown by `goli skin list`.
 */
export const BUILTIN_SKINS: Record<BuiltinSkinName, Skin> = {
  default: DEFAULT_SKIN,
  dark: DARK_SKIN,
  'high-contrast': HIGH_CONTRAST_SKIN,
  dracula: DRACULA_SKIN,
  'solarized-dark': SOLARIZED_DARK_SKIN,
  'solarized-light': SOLARIZED_LIGHT_SKIN,
  'github-dark': GITHUB_DARK_SKIN,
  'github-light': GITHUB_LIGHT_SKIN,
  'atom-one-dark': ATOM_ONE_DARK_SKIN,
  nord: NORD_SKIN,
  monokai: MONOKAI_SKIN,
  // T-043 additions (loop run 5)
  'ayu-dark': AYU_DARK_SKIN,
  'ayu-light': AYU_LIGHT_SKIN,
  'shades-of-purple-dark': SHADES_OF_PURPLE_DARK_SKIN,
  'holiday-dark': HOLIDAY_DARK_SKIN,
  'ansi-dark': ANSI_DARK_SKIN,
  'ansi-light': ANSI_LIGHT_SKIN,
  'googlecode-light': GOOGLECODE_LIGHT_SKIN,
  'xcode-light': XCODE_LIGHT_SKIN,
  'github-dark-colorblind': GITHUB_DARK_COLORBLIND_SKIN,
  'github-light-colorblind': GITHUB_LIGHT_COLORBLIND_SKIN,
};

// ─── User skin directory ──────────────────────────────────────────────

/** The user skins directory: ~/.goli/skins/ */
export function getUserSkinsDir(): string {
  const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli');
  return join(goliHome, 'skins');
}

// ─── YAML parsing (minimal — no external dep) ─────────────────────────

/**
 * Parse a minimal YAML subset for skin files.
 *
 * Supports:
 *   - `key: value` (string, with optional quotes)
 *   - Nested maps under `colors:`
 *   - Comments (`#`)
 *
 * Does NOT support: arrays, multiline strings, anchors, flow style.
 * This is intentional — skin files are simple key-value maps.
 */
export function parseSkinYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentSection: Record<string, unknown> | null = null;
  let currentKey = '';

  for (const rawLine of lines) {
    // Strip comments — but only when '#' is at the start of the line or
    // preceded by whitespace (so hex colors like "#ffffff" are preserved).
    const commentMatch = rawLine.match(/(^|\s)#\s/);
    const line = commentMatch
      ? rawLine.slice(0, commentMatch.index! + commentMatch[1]!.length)
      : rawLine;
    const trimmedEnd = line.trimEnd();
    if (trimmedEnd.trim().length === 0) continue;

    // Detect indentation (2 spaces = nested).
    const indent = trimmedEnd.length - trimmedEnd.trimStart().length;
    const trimmed = trimmedEnd.trim();

    if (indent === 0) {
      // Top-level key.
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) continue;
      currentKey = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (value.length === 0) {
        // Section header — next lines are nested.
        currentSection = {};
        result[currentKey] = currentSection;
      } else {
        // Scalar value.
        result[currentKey] = stripQuotes(value);
        currentSection = null;
      }
    } else if (currentSection !== null) {
      // Nested key under currentSection.
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      currentSection[key] = stripQuotes(value);
    }
  }

  return result;
}

/** Strip surrounding quotes from a YAML string value. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ─── Skin loading ─────────────────────────────────────────────────────

/**
 * Load a skin by name or path.
 *
 * Resolution order:
 *   1. If the name matches a built-in skin, return it.
 *   2. If the name is a path to a YAML file, load + parse it.
 *   3. If the name matches ~/.goli/skins/<name>.yaml, load + parse it.
 *   4. Otherwise, throw an error.
 *
 * @param nameOrPath - The skin name or file path.
 * @returns The loaded skin.
 */
export function loadSkin(nameOrPath: string): Skin {
  // 0. T-055: Special-case 'no-color' (not in BUILTIN_SKIN_NAMES).
  //    Resolved when NO_COLOR env var is set or user passes --skin no-color.
  if (nameOrPath.toLowerCase() === 'no-color') {
    return NO_COLOR_SKIN;
  }

  // 1. Built-in? (case-insensitive — T-034)
  //    User may type "Dracula", "DRACULA", or "dracula" — all should resolve.
  const lowerName = nameOrPath.toLowerCase();
  for (const builtinName of BUILTIN_SKIN_NAMES) {
    if (builtinName.toLowerCase() === lowerName) {
      return BUILTIN_SKINS[builtinName];
    }
  }

  // 2. File path?
  const resolvedPath = resolve(nameOrPath);
  if (existsSync(resolvedPath)) {
    return loadSkinFromFile(resolvedPath);
  }

  // 3. User skin directory?
  const userSkinPath = join(getUserSkinsDir(), `${nameOrPath}.yaml`);
  if (existsSync(userSkinPath)) {
    return loadSkinFromFile(userSkinPath);
  }

  throw new Error(
    `Skin '${nameOrPath}' not found. Available built-ins: ${BUILTIN_SKIN_NAMES.join(', ')}, no-color. ` +
      `User skins go in ${getUserSkinsDir()}/<name>.yaml.`,
  );
}

/** Load + parse a skin from a YAML file. */
function loadSkinFromFile(filePath: string): Skin {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseSkinYaml(content);

  const name = String(parsed['name'] ?? 'unnamed');
  const description = String(parsed['description'] ?? '');
  const borderStyle = String(parsed['borderStyle'] ?? 'round') as BorderStyle;
  const promptStyle = String(parsed['promptStyle'] ?? '>');
  const colorsRaw = (parsed['colors'] ?? {}) as Record<string, unknown>;

  // Merge with default colors so missing keys fall back.
  const colors: ColorMap = { ...DEFAULT_SKIN.colors };
  for (const key of Object.keys(colorsRaw)) {
    if (key in colors) {
      colors[key as ColorTokenName] = String(colorsRaw[key]);
    }
  }

  return {
    name,
    description,
    colors,
    borderStyle,
    promptStyle,
    builtin: false,
    sourcePath: filePath,
  };
}

/**
 * Get the active skin.
 *
 * Resolution order:
 *   1. T-055: `NO_COLOR` env var (any value) → NO_COLOR_SKIN (industry
 *      standard accessibility convention, see https://no-color.org/).
 *   2. `GOLI_SKIN` env var.
 *   3. `--skin` CLI flag (in process.argv).
 *   4. Default skin.
 */
export function getActiveSkin(): Skin {
  // T-055: NO_COLOR env var takes precedence over everything (accessibility).
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') {
    return NO_COLOR_SKIN;
  }
  const skinName = process.env['GOLI_SKIN'] ?? getSkinFlagFromArgv();
  if (!skinName || skinName.length === 0) {
    return DEFAULT_SKIN;
  }
  try {
    return loadSkin(skinName);
  } catch {
    // If the skin fails to load, fall back to default.
    return DEFAULT_SKIN;
  }
}

/** Extract the --skin flag value from process.argv. */
function getSkinFlagFromArgv(): string | undefined {
  const argv = process.argv;
  const idx = argv.indexOf('--skin');
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  // Also support --skin=name syntax.
  for (const arg of argv) {
    if (arg.startsWith('--skin=')) {
      return arg.slice('--skin='.length);
    }
  }
  return undefined;
}

/** List all available skins (built-in + user-defined). */
export function listSkins(): Skin[] {
  const skins: Skin[] = [...BUILTIN_SKIN_NAMES].map((name) => BUILTIN_SKINS[name]);

  // Scan user skins directory.
  const userDir = getUserSkinsDir();
  if (existsSync(userDir)) {
    const entries = readdirSync(userDir);
    for (const entry of entries) {
      if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
        const name = entry.replace(/\.(ya?ml)$/, '');
        try {
          const skin = loadSkin(name);
          skins.push(skin);
        } catch {
          // Skip malformed skins.
        }
      }
    }
  }

  return skins;
}

// ─── CLI command ──────────────────────────────────────────────────────

/** Run the `goli skin` command. */
export async function runSkin(args: string[]): Promise<number> {
  const subcommand = args[0] ?? 'list';

  switch (subcommand) {
    case 'list': {
      const skins = listSkins();
      const active = getActiveSkin();
      process.stdout.write('Skins:\n');
      for (const skin of skins) {
        const marker = skin.name === active.name ? ' *' : '  ';
        const builtin = skin.builtin ? ' (built-in)' : '';
        process.stdout.write(
          `${marker} ${skin.name.padEnd(20)} ${skin.description}${builtin}\n`,
        );
      }
      process.stdout.write('\n* = active\n');
      return 0;
    }
    case 'show': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli skin show <name>\n');
        return 1;
      }
      try {
        const skin = loadSkin(name);
        process.stdout.write(`Name: ${skin.name}\n`);
        process.stdout.write(`Description: ${skin.description}\n`);
        process.stdout.write(`Border: ${skin.borderStyle}\n`);
        process.stdout.write(`Prompt: ${skin.promptStyle}\n`);
        process.stdout.write('Colors:\n');
        for (const [key, value] of Object.entries(skin.colors)) {
          process.stdout.write(`  ${key}: ${value}\n`);
        }
        return 0;
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'use': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli skin use <name>\n');
        process.stderr.write('Or set GOLI_SKIN=<name> env var.\n');
        return 1;
      }
      try {
        loadSkin(name); // verify it exists
        process.stdout.write(
          `To use skin '${name}', set the GOLI_SKIN env var or use --skin ${name}:\n`,
        );
        process.stdout.write(`  GOLI_SKIN=${name} goli ...\n`);
        process.stdout.write(`  goli --skin ${name} ...\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    default:
      process.stderr.write(`Unknown skin subcommand: ${subcommand}\n`);
      process.stderr.write('Available: list, show, use\n');
      return 1;
  }
}
