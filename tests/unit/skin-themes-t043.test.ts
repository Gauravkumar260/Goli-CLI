/**
 * Unit tests for T-043 — Built-in theme expansion to 20 (full gemini-cli parity).
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. ≥9 new built-in skins added.
 *  2. BUILTIN_SKIN_NAMES grows from 11 to ≥20.
 *  3. Each new skin has full 10-color ColorMap.
 *  4. Tests verify each new skin loads + colors match /^#[0-9a-fA-F]{6}$/.
 *  5. WCAG AA contrast verified for each new skin's fg.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  BUILTIN_SKINS,
  BUILTIN_SKIN_NAMES,
  AYU_DARK_SKIN,
  AYU_LIGHT_SKIN,
  SHADES_OF_PURPLE_DARK_SKIN,
  HOLIDAY_DARK_SKIN,
  ANSI_DARK_SKIN,
  ANSI_LIGHT_SKIN,
  GOOGLECODE_LIGHT_SKIN,
  XCODE_LIGHT_SKIN,
  GITHUB_DARK_COLORBLIND_SKIN,
  GITHUB_LIGHT_COLORBLIND_SKIN,
  loadSkin,
  getActiveSkin,
  type Skin,
  type ColorTokenName,
} from '../../packages/cli/src/tui/theme/skin-engine.js';

const NEW_SKIN_NAMES_T043 = [
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

const ALL_TOKENS: ColorTokenName[] = [
  'fg', 'blue', 'green', 'red', 'yellow',
  'purple', 'teal', 'gray', 'border', 'orange',
];

let originalGoliSkin: string | undefined;
let originalNoColor: string | undefined;
let originalArgv: string[];

beforeEach(() => {
  originalGoliSkin = process.env['GOLI_SKIN'];
  originalNoColor = process.env['NO_COLOR'];
  originalArgv = process.argv;
  delete process.env['GOLI_SKIN'];
  // T-055: clear NO_COLOR so it doesn't override GOLI_SKIN in getActiveSkin().
  delete process.env['NO_COLOR'];
  process.argv = ['node', 'goli'];
});

afterEach(() => {
  if (originalGoliSkin !== undefined) {
    process.env['GOLI_SKIN'] = originalGoliSkin;
  } else {
    delete process.env['GOLI_SKIN'];
  }
  if (originalNoColor !== undefined) {
    process.env['NO_COLOR'] = originalNoColor;
  } else {
    delete process.env['NO_COLOR'];
  }
  process.argv = originalArgv;
});

describe('T-043: Theme expansion to 20 (full gemini-cli parity)', () => {
  describe('BUILTIN_SKIN_NAMES includes the 10 new themes', () => {
    it('BUILTIN_SKIN_NAMES has length 20 (11 from T-034 + 10 from T-043)', () => {
      expect(BUILTIN_SKIN_NAMES.length).toBeGreaterThanOrEqual(20);
    });

    it.each(NEW_SKIN_NAMES_T043)('%s is in BUILTIN_SKIN_NAMES', (name) => {
      expect(BUILTIN_SKIN_NAMES).toContain(name);
    });

    it('original 11 skins are still present', () => {
      const original11 = [
        'default', 'dark', 'high-contrast', 'dracula',
        'solarized-dark', 'solarized-light', 'github-dark', 'github-light',
        'atom-one-dark', 'nord', 'monokai',
      ];
      for (const name of original11) {
        expect(BUILTIN_SKIN_NAMES).toContain(name);
      }
    });
  });

  describe('BUILTIN_SKINS map has all 20+ entries', () => {
    it('BUILTIN_SKINS has ≥20 keys', () => {
      expect(Object.keys(BUILTIN_SKINS).length).toBeGreaterThanOrEqual(20);
    });

    it.each(NEW_SKIN_NAMES_T043)('%s is in BUILTIN_SKINS map', (name) => {
      expect(BUILTIN_SKINS).toHaveProperty(name);
    });
  });

  describe('Each new skin has a full 10-color ColorMap', () => {
    const NEW_SKINS: Array<[string, Skin]> = [
      ['ayu-dark', AYU_DARK_SKIN],
      ['ayu-light', AYU_LIGHT_SKIN],
      ['shades-of-purple-dark', SHADES_OF_PURPLE_DARK_SKIN],
      ['holiday-dark', HOLIDAY_DARK_SKIN],
      ['ansi-dark', ANSI_DARK_SKIN],
      ['ansi-light', ANSI_LIGHT_SKIN],
      ['googlecode-light', GOOGLECODE_LIGHT_SKIN],
      ['xcode-light', XCODE_LIGHT_SKIN],
      ['github-dark-colorblind', GITHUB_DARK_COLORBLIND_SKIN],
      ['github-light-colorblind', GITHUB_LIGHT_COLORBLIND_SKIN],
    ];

    it.each(NEW_SKINS)('%s has all 10 color tokens matching /^#[0-9a-fA-F]{6}$/', (name, skin) => {
      for (const token of ALL_TOKENS) {
        expect(skin.colors[token], `${name}.${token} must be defined`).toBeDefined();
        expect(skin.colors[token], `${name}.${token} must match hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it.each(NEW_SKINS)('%s has valid metadata', (_name, skin) => {
      const validBorders = ['single', 'double', 'round', 'bold', 'singleDouble', 'classic', 'arrow'];
      expect(validBorders).toContain(skin.borderStyle);
      expect(skin.promptStyle.length).toBeGreaterThan(0);
      expect(skin.builtin).toBe(true);
      expect(skin.description.length).toBeGreaterThan(0);
    });
  });

  describe('loadSkin returns each new skin by name', () => {
    it.each(NEW_SKIN_NAMES_T043)('loadSkin("%s") returns the skin', (name) => {
      const skin = loadSkin(name);
      expect(skin.name).toBe(name);
      expect(skin.builtin).toBe(true);
    });
  });

  describe('Case-insensitive lookup works for new skins', () => {
    it.each([
      ['AYU-DARK', 'ayu-dark'],
      ['Ayu-Light', 'ayu-light'],
      ['HOLIDAY-DARK', 'holiday-dark'],
      ['Googlecode-Light', 'googlecode-light'],
      ['XCODE-LIGHT', 'xcode-light'],
    ])('loadSkin("%s") resolves to %s', (input, expectedName) => {
      const skin = loadSkin(input);
      expect(skin.name).toBe(expectedName);
    });
  });

  describe('getActiveSkin returns the correct skin via GOLI_SKIN', () => {
    it.each(NEW_SKIN_NAMES_T043)('GOLI_SKIN=%s → getActiveSkin returns it', (name) => {
      process.env['GOLI_SKIN'] = name;
      const skin = getActiveSkin();
      expect(skin.name).toBe(name);
    });
  });

  describe('Canonical palette verification', () => {
    it('Ayu Dark has the canonical fg #aeaca6 and orange #ffb454', () => {
      expect(AYU_DARK_SKIN.colors.fg).toBe('#aeaca6');
      expect(AYU_DARK_SKIN.colors.orange).toBe('#ffb454');
      expect(AYU_DARK_SKIN.colors.green).toBe('#aad94c');
    });

    it('Ayu Light has the canonical fg #5c6166 and blue #399ee6', () => {
      expect(AYU_LIGHT_SKIN.colors.fg).toBe('#5c6166');
      expect(AYU_LIGHT_SKIN.colors.blue).toBe('#399ee6');
    });

    it('Shades of Purple Dark has the canonical fg #e3dfff and purple #ac65ff', () => {
      expect(SHADES_OF_PURPLE_DARK_SKIN.colors.fg).toBe('#e3dfff');
      expect(SHADES_OF_PURPLE_DARK_SKIN.colors.purple).toBe('#ac65ff');
    });

    it('Holiday Dark has the canonical fg #f0f8ff and red #ff6347', () => {
      expect(HOLIDAY_DARK_SKIN.colors.fg).toBe('#f0f8ff');
      expect(HOLIDAY_DARK_SKIN.colors.red).toBe('#ff6347');
    });

    it('ANSI Dark uses pure RGB primaries (#ff0000, #00ff00, #0000ff)', () => {
      expect(ANSI_DARK_SKIN.colors.red).toBe('#ff0000');
      expect(ANSI_DARK_SKIN.colors.green).toBe('#00ff00');
      expect(ANSI_DARK_SKIN.colors.blue).toBe('#0000ff');
    });

    it('ANSI Light uses black foreground (#000000)', () => {
      expect(ANSI_LIGHT_SKIN.colors.fg).toBe('#000000');
    });

    it('Googlecode Light has the canonical fg #444444 and blue #000088', () => {
      expect(GOOGLECODE_LIGHT_SKIN.colors.fg).toBe('#444444');
      expect(GOOGLECODE_LIGHT_SKIN.colors.blue).toBe('#000088');
    });

    it('XCode Light has the canonical blue #1c00cf and red #c41a16', () => {
      expect(XCODE_LIGHT_SKIN.colors.blue).toBe('#1c00cf');
      expect(XCODE_LIGHT_SKIN.colors.red).toBe('#c41a16');
    });

    it('GitHub Dark Colorblind has blue-shifted green (#a5d6ff)', () => {
      expect(GITHUB_DARK_COLORBLIND_SKIN.colors.green).toBe('#a5d6ff');
      expect(GITHUB_DARK_COLORBLIND_SKIN.colors.red).toBe('#f0883e'); // orange-shifted
    });

    it('GitHub Light Colorblind has blue-shifted green (#0969da)', () => {
      expect(GITHUB_LIGHT_COLORBLIND_SKIN.colors.green).toBe('#0969da');
      expect(GITHUB_LIGHT_COLORBLIND_SKIN.colors.red).toBe('#bc4c00'); // orange-shifted
    });
  });

  describe('Colorblind accessibility', () => {
    it('github-dark-colorblind uses blue/orange (not red/green) for status colors', () => {
      // In colorblind themes, green and red should NOT both be used for
      // success/error indicators. We verify green is blue-shifted and
      // red is orange-shifted so they're distinguishable to colorblind users.
      const green = GITHUB_DARK_COLORBLIND_SKIN.colors.green;
      const red = GITHUB_DARK_COLORBLIND_SKIN.colors.red;
      // Green should not be a pure green (it's #a5d6ff, a light blue)
      expect(green).not.toMatch(/^#0+[0-9a-f]+$/i);
      // Red should not be a pure red (it's #f0883e, an orange)
      expect(red).not.toMatch(/^#[0-9a-f]+0+$/i);
    });

    it('github-light-colorblind follows the same colorblind pattern', () => {
      const green = GITHUB_LIGHT_COLORBLIND_SKIN.colors.green;
      const red = GITHUB_LIGHT_COLORBLIND_SKIN.colors.red;
      // Green is #0969da (blue); red is #bc4c00 (orange)
      expect(green.toLowerCase()).toBe('#0969da');
      expect(red.toLowerCase()).toBe('#bc4c00');
    });
  });

  describe('WCAG AA contrast for new skins (fg on intended background)', () => {
    // Reuse the contrast ratio utility from T-042's test file.
    function hexToRgb(hex: string): [number, number, number] {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) throw new Error(`Invalid hex: ${hex}`);
      const n = parseInt(m[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function relativeLuminance(hex: string): number {
      const [r, g, b] = hexToRgb(hex);
      const toLinear = (c: number): number => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }

    function contrastRatio(fgHex: string, bgHex: string): number {
      const l1 = relativeLuminance(fgHex);
      const l2 = relativeLuminance(bgHex);
      const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
      return (lighter + 0.05) / (darker + 0.05);
    }

    const SKIN_BACKGROUNDS: Record<string, string> = {
      'ayu-dark': '#0b0e14',
      'ayu-light': '#f8f9fa',
      'shades-of-purple-dark': '#1e1e3f',
      'holiday-dark': '#00210e',
      'ansi-dark': '#000000',
      'ansi-light': '#ffffff',
      'googlecode-light': '#ffffff',
      'xcode-light': '#ffffff',
      'github-dark-colorblind': '#0d1117',
      'github-light-colorblind': '#ffffff',
    };

    const NEW_SKINS_WITH_BG: Array<[string, Skin]> = [
      ['ayu-dark', AYU_DARK_SKIN],
      ['ayu-light', AYU_LIGHT_SKIN],
      ['shades-of-purple-dark', SHADES_OF_PURPLE_DARK_SKIN],
      ['holiday-dark', HOLIDAY_DARK_SKIN],
      ['ansi-dark', ANSI_DARK_SKIN],
      ['ansi-light', ANSI_LIGHT_SKIN],
      ['googlecode-light', GOOGLECODE_LIGHT_SKIN],
      ['xcode-light', XCODE_LIGHT_SKIN],
      ['github-dark-colorblind', GITHUB_DARK_COLORBLIND_SKIN],
      ['github-light-colorblind', GITHUB_LIGHT_COLORBLIND_SKIN],
    ];

    it.each(NEW_SKINS_WITH_BG)(
      '%s skin: fg meets WCAG AA (≥4.5:1) on its background',
      (name, skin) => {
        const bg = SKIN_BACKGROUNDS[name]!;
        const ratio = contrastRatio(skin.colors.fg, bg);
        expect(ratio, `${name}.fg = ${ratio}:1 (need ≥4.5:1)`).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
