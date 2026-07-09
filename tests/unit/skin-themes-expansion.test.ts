/**
 * Unit tests for T-034 — Built-in theme expansion (3 → 11 themes).
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. ≥7 new built-in skins added (dracula, solarized-dark, solarized-light,
 *     github-dark, github-light, atom-one-dark, nord, monokai).
 *  2. Each new skin has full 10-color ColorMap matching the canonical palette.
 *  3. Skin names are case-insensitive and validated in loadSkin().
 *  4. Tests verify each new skin: BUILTIN_SKIN_NAMES includes them;
 *     getActiveSkin returns each; all colors match /^#[0-9a-fA-F]{6}$/.
 *
 * Comparison reference: gemini-cli ships 20 themes (11 dark + 8 light + 1
 * no-color). After T-034, Goli-CLI ships 11 (8 dark + 2 light + 1 high-
 * contrast). The remaining 9-theme gap is closed by user-defined skins
 * (~/.goli/skins/<name>.yaml) and is documented in AGENTS.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  BUILTIN_SKINS,
  BUILTIN_SKIN_NAMES,
  DRACULA_SKIN,
  SOLARIZED_DARK_SKIN,
  SOLARIZED_LIGHT_SKIN,
  GITHUB_DARK_SKIN,
  GITHUB_LIGHT_SKIN,
  ATOM_ONE_DARK_SKIN,
  NORD_SKIN,
  MONOKAI_SKIN,
  DEFAULT_SKIN,
  DARK_SKIN,
  HIGH_CONTRAST_SKIN,
  loadSkin,
  getActiveSkin,
  type Skin,
  type ColorTokenName,
} from '../../packages/cli/src/tui/theme/skin-engine.js';

const NEW_SKIN_NAMES = [
  'dracula',
  'solarized-dark',
  'solarized-light',
  'github-dark',
  'github-light',
  'atom-one-dark',
  'nord',
  'monokai',
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

describe('T-034: Built-in theme expansion', () => {
  describe('BUILTIN_SKIN_NAMES includes the 8 new themes', () => {
    it('BUILTIN_SKIN_NAMES has length 11 (3 original + 8 new from T-034; T-043 adds more)', () => {
      // T-034 expanded from 3 to 11; T-043 (loop run 5) expanded from 11 to 20.
      // We assert ≥11 here (the T-034 contract); the T-043 test asserts ≥20.
      expect(BUILTIN_SKIN_NAMES.length).toBeGreaterThanOrEqual(11);
    });

    it.each(NEW_SKIN_NAMES)('%s is in BUILTIN_SKIN_NAMES', (name) => {
      expect(BUILTIN_SKIN_NAMES).toContain(name);
    });

    it('original 3 skins are still present', () => {
      expect(BUILTIN_SKIN_NAMES).toContain('default');
      expect(BUILTIN_SKIN_NAMES).toContain('dark');
      expect(BUILTIN_SKIN_NAMES).toContain('high-contrast');
    });
  });

  describe('BUILTIN_SKINS map has all 11 entries (T-034 contract)', () => {
    it('BUILTIN_SKINS has ≥11 keys (T-034 added 11; T-043 added more)', () => {
      expect(Object.keys(BUILTIN_SKINS).length).toBeGreaterThanOrEqual(11);
    });

    it.each(NEW_SKIN_NAMES)('%s is in BUILTIN_SKINS map', (name) => {
      expect(BUILTIN_SKINS).toHaveProperty(name);
    });
  });

  describe('Each new skin has a full 10-color ColorMap', () => {
    const NEW_SKINS: Array<[string, Skin]> = [
      ['dracula', DRACULA_SKIN],
      ['solarized-dark', SOLARIZED_DARK_SKIN],
      ['solarized-light', SOLARIZED_LIGHT_SKIN],
      ['github-dark', GITHUB_DARK_SKIN],
      ['github-light', GITHUB_LIGHT_SKIN],
      ['atom-one-dark', ATOM_ONE_DARK_SKIN],
      ['nord', NORD_SKIN],
      ['monokai', MONOKAI_SKIN],
    ];

    it.each(NEW_SKINS)('%s has all 10 color tokens', (name, skin) => {
      for (const token of ALL_TOKENS) {
        expect(skin.colors[token], `${name}.${token} must be defined`).toBeDefined();
        expect(skin.colors[token], `${name}.${token} must match hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it.each(NEW_SKINS)('%s has a valid borderStyle', (name, skin) => {
      const validBorders = ['single', 'double', 'round', 'bold', 'singleDouble', 'classic', 'arrow'];
      expect(validBorders).toContain(skin.borderStyle);
    });

    it.each(NEW_SKINS)('%s has a non-empty promptStyle', (_name, skin) => {
      expect(skin.promptStyle.length).toBeGreaterThan(0);
    });

    it.each(NEW_SKINS)('%s has builtin=true', (_name, skin) => {
      expect(skin.builtin).toBe(true);
    });

    it.each(NEW_SKINS)('%s has a non-empty description', (_name, skin) => {
      expect(skin.description.length).toBeGreaterThan(0);
    });
  });

  describe('loadSkin returns each new skin by name', () => {
    it.each(NEW_SKIN_NAMES)('loadSkin("%s") returns the skin', (name) => {
      const skin = loadSkin(name);
      expect(skin.name).toBe(name);
      expect(skin.builtin).toBe(true);
    });
  });

  describe('Case-insensitive skin name lookup (T-034 AC #3)', () => {
    it.each([
      ['Dracula', 'dracula'],
      ['DRACULA', 'dracula'],
      ['DrAcUlA', 'dracula'],
      ['NORD', 'nord'],
      ['Monokai', 'monokai'],
      ['GITHUB-DARK', 'github-dark'],
      ['Solarized-Light', 'solarized-light'],
    ])('loadSkin("%s") resolves to %s', (input, expectedName) => {
      const skin = loadSkin(input);
      expect(skin.name).toBe(expectedName);
    });

    it('case-insensitive lookup does not break original 3 skins', () => {
      expect(loadSkin('DEFAULT').name).toBe('default');
      expect(loadSkin('Dark').name).toBe('dark');
      expect(loadSkin('HIGH-CONTRAST').name).toBe('high-contrast');
    });

    it('case-insensitive lookup does not fall through to file path for unknown names', () => {
      // An unknown name that is NOT a file path should still throw.
      expect(() => loadSkin('nonexistent-skin-name')).toThrow(/not found/);
    });
  });

  describe('getActiveSkin returns the correct skin via GOLI_SKIN', () => {
    it.each(NEW_SKIN_NAMES)('GOLI_SKIN=%s → getActiveSkin returns it', (name) => {
      process.env['GOLI_SKIN'] = name;
      const skin = getActiveSkin();
      expect(skin.name).toBe(name);
    });

    it('GOLI_SKIN=Dracula (case-mixed) → getActiveSkin returns dracula', () => {
      process.env['GOLI_SKIN'] = 'Dracula';
      const skin = getActiveSkin();
      expect(skin.name).toBe('dracula');
    });
  });

  describe('Canonical palette verification (T-034 AC #2)', () => {
    it('Dracula has the canonical foreground #f8f8f2 and pink #ff79c6', () => {
      expect(DRACULA_SKIN.colors.fg).toBe('#f8f8f2');
      expect(DRACULA_SKIN.colors.purple).toBe('#ff79c6');
      expect(DRACULA_SKIN.colors.teal).toBe('#8be9fd');
      expect(DRACULA_SKIN.colors.green).toBe('#50fa7b');
    });

    it('Solarized Dark has the canonical blue #268bd2 and base01 #586e75', () => {
      expect(SOLARIZED_DARK_SKIN.colors.blue).toBe('#268bd2');
      expect(SOLARIZED_DARK_SKIN.colors.gray).toBe('#586e75');
      expect(SOLARIZED_DARK_SKIN.colors.green).toBe('#859900');
      expect(SOLARIZED_DARK_SKIN.colors.red).toBe('#dc322f');
    });

    it('Solarized Light has the canonical foreground #586e75 (base00)', () => {
      expect(SOLARIZED_LIGHT_SKIN.colors.fg).toBe('#586e75');
      expect(SOLARIZED_LIGHT_SKIN.colors.gray).toBe('#93a1a1');
    });

    it('GitHub Dark has the canonical blue #58a6ff and green #3fb950', () => {
      expect(GITHUB_DARK_SKIN.colors.blue).toBe('#58a6ff');
      expect(GITHUB_DARK_SKIN.colors.green).toBe('#3fb950');
      expect(GITHUB_DARK_SKIN.colors.red).toBe('#f85149');
      expect(GITHUB_DARK_SKIN.colors.fg).toBe('#c9d1d9');
    });

    it('GitHub Light has the canonical blue #0969da and foreground #1f2328', () => {
      expect(GITHUB_LIGHT_SKIN.colors.blue).toBe('#0969da');
      expect(GITHUB_LIGHT_SKIN.colors.fg).toBe('#1f2328');
    });

    it('Atom One Dark has the canonical red #e06c75 and blue #61afef', () => {
      expect(ATOM_ONE_DARK_SKIN.colors.red).toBe('#e06c75');
      expect(ATOM_ONE_DARK_SKIN.colors.blue).toBe('#61afef');
      expect(ATOM_ONE_DARK_SKIN.colors.fg).toBe('#abb2bf');
    });

    it('Nord has the canonical frost #88c0d0 and aurora red #bf616a', () => {
      expect(NORD_SKIN.colors.teal).toBe('#88c0d0');
      expect(NORD_SKIN.colors.red).toBe('#bf616a');
      expect(NORD_SKIN.colors.fg).toBe('#d8dee9');
    });

    it('Monokai has the canonical pink #f92672 and orange #fd971f', () => {
      expect(MONOKAI_SKIN.colors.red).toBe('#f92672');
      expect(MONOKAI_SKIN.colors.orange).toBe('#fd971f');
      expect(MONOKAI_SKIN.colors.green).toBe('#a6e22e');
      expect(MONOKAI_SKIN.colors.fg).toBe('#f8f8f2');
    });
  });

  describe('Original 3 skins are unchanged', () => {
    it('DEFAULT_SKIN colors are Tokyo Night Dark', () => {
      expect(DEFAULT_SKIN.colors.fg).toBe('#c0caf5');
      expect(DEFAULT_SKIN.colors.blue).toBe('#7aa2f7');
      expect(DEFAULT_SKIN.colors.border).toBe('#414868');
    });

    it('DARK_SKIN colors are Dark Warm', () => {
      expect(DARK_SKIN.colors.fg).toBe('#e6e6e6');
      expect(DARK_SKIN.colors.purple).toBe('#c792ea');
    });

    it('HIGH_CONTRAST_SKIN colors are WCAG AAA', () => {
      expect(HIGH_CONTRAST_SKIN.colors.fg).toBe('#ffffff');
      expect(HIGH_CONTRAST_SKIN.colors.border).toBe('#ffffff');
    });
  });

  describe('All skins are distinct objects (sanity check)', () => {
    it('all 11 skins have distinct names', () => {
      const allSkins = [
        DEFAULT_SKIN, DARK_SKIN, HIGH_CONTRAST_SKIN,
        DRACULA_SKIN, SOLARIZED_DARK_SKIN, SOLARIZED_LIGHT_SKIN,
        GITHUB_DARK_SKIN, GITHUB_LIGHT_SKIN, ATOM_ONE_DARK_SKIN,
        NORD_SKIN, MONOKAI_SKIN,
      ];
      const names = new Set(allSkins.map((s) => s.name));
      expect(names.size).toBe(allSkins.length);
    });

    it('Dracula and Monokai share #f8f8f2 foreground (canonical collision, not a bug)', () => {
      // Both palettes are defined by their original authors with this same fg.
      // We assert the collision is intentional and documented.
      expect(DRACULA_SKIN.colors.fg).toBe('#f8f8f2');
      expect(MONOKAI_SKIN.colors.fg).toBe('#f8f8f2');
      // The palettes are still distinguishable by their accent colors:
      expect(DRACULA_SKIN.colors.purple).not.toBe(MONOKAI_SKIN.colors.purple);
      expect(DRACULA_SKIN.colors.red).not.toBe(MONOKAI_SKIN.colors.red);
    });
  });
});
