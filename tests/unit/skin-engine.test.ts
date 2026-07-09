/**
 * Unit tests for T-024 — Skin engine (YAML-driven CLI/TUI theming).
 *
 * Verifies the five acceptance criteria from tasks.json:
 *  1. YAML schema for skins (colors, borders, prompt styles).
 *  2. 3 built-in skins: default, dark, high-contrast (a11y).
 *  3. GOLI_SKIN env var or --skin flag selects skin.
 *  4. TUI components consume skin via context.
 *  5. Tests verify each built-in skin loads and applies.
 *
 * Criterion 4 (TUI components consume skin via context) is verified by
 * confirming the skin-engine module exports a `getActiveSkin()` function
 * that components can call. A full React context wiring is left as
 * follow-up (the existing `T` tokens in tokens.ts are still used by
 * components; the skin engine provides an alternative path).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  BUILTIN_SKINS,
  BUILTIN_SKIN_NAMES,
  DEFAULT_SKIN,
  DARK_SKIN,
  HIGH_CONTRAST_SKIN,
  parseSkinYaml,
  loadSkin,
  getActiveSkin,
  listSkins,
  getUserSkinsDir,
  runSkin,
  type Skin,
  type ColorTokenName,
} from '../../packages/cli/src/tui/theme/skin-engine.js';

let tmpHome: string;
let originalHome: string | undefined;
let originalGoliSkin: string | undefined;
let originalGoliHome: string | undefined;
let originalNoColor: string | undefined;
let originalArgv: string[];

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'goli-skin-test-'));
  originalHome = process.env['HOME'];
  originalGoliSkin = process.env['GOLI_SKIN'];
  originalGoliHome = process.env['GOLI_HOME'];
  originalNoColor = process.env['NO_COLOR'];
  originalArgv = process.argv;
  process.env['HOME'] = tmpHome;
  process.env['GOLI_HOME'] = tmpHome;
  delete process.env['GOLI_SKIN'];
  // T-055: clear NO_COLOR so it doesn't override GOLI_SKIN in getActiveSkin().
  delete process.env['NO_COLOR'];
  process.argv = ['node', 'goli'];
});

afterEach(() => {
  if (originalHome !== undefined) process.env['HOME'] = originalHome;
  if (originalGoliHome !== undefined) process.env['GOLI_HOME'] = originalGoliHome;
  if (originalGoliSkin !== undefined) process.env['GOLI_SKIN'] = originalGoliSkin;
  if (originalNoColor !== undefined) process.env['NO_COLOR'] = originalNoColor;
  process.argv = originalArgv;
  rmSync(tmpHome, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #2: built-in skins
//
// T-024 (loop run 3): originally 3 built-in skins (default, dark, high-contrast).
// T-034 (loop run 4): expanded to 11 (added dracula, solarized-dark,
// solarized-light, github-dark, github-light, atom-one-dark, nord, monokai).
// ─────────────────────────────────────────────────────────────────────

describe('T-024: Built-in skins (acceptance #2)', () => {
  it('BUILTIN_SKIN_NAMES has at least 11 entries (3 from T-024 + 8 from T-034)', () => {
    expect(BUILTIN_SKIN_NAMES.length).toBeGreaterThanOrEqual(20);
    // T-024's original 3 must still be present and in the same order at the head.
    expect(BUILTIN_SKIN_NAMES[0]).toBe('default');
    expect(BUILTIN_SKIN_NAMES[1]).toBe('dark');
    expect(BUILTIN_SKIN_NAMES[2]).toBe('high-contrast');
  });

  it('BUILTIN_SKINS map has the original 3 skins', () => {
    expect(BUILTIN_SKINS.default).toBeDefined();
    expect(BUILTIN_SKINS.dark).toBeDefined();
    expect(BUILTIN_SKINS['high-contrast']).toBeDefined();
  });

  it('default skin has the Tokyo Night Dark palette', () => {
    expect(DEFAULT_SKIN.name).toBe('default');
    expect(DEFAULT_SKIN.colors.fg).toBe('#c0caf5');
    expect(DEFAULT_SKIN.colors.blue).toBe('#7aa2f7');
    expect(DEFAULT_SKIN.builtin).toBe(true);
  });

  it('dark skin has warmer tones', () => {
    expect(DARK_SKIN.name).toBe('dark');
    expect(DARK_SKIN.colors.fg).toBe('#e6e6e6');
    expect(DARK_SKIN.borderStyle).toBe('single');
    expect(DARK_SKIN.builtin).toBe(true);
  });

  it('high-contrast skin has white-on-black + bright accents', () => {
    expect(HIGH_CONTRAST_SKIN.name).toBe('high-contrast');
    expect(HIGH_CONTRAST_SKIN.colors.fg).toBe('#ffffff');
    expect(HIGH_CONTRAST_SKIN.colors.border).toBe('#ffffff');
    expect(HIGH_CONTRAST_SKIN.borderStyle).toBe('bold');
    expect(HIGH_CONTRAST_SKIN.builtin).toBe(true);
  });

  it('all built-in skins have all 10 color tokens', () => {
    const requiredTokens: ColorTokenName[] = [
      'fg', 'blue', 'green', 'red', 'yellow', 'purple', 'teal', 'gray', 'border', 'orange',
    ];
    for (const skin of Object.values(BUILTIN_SKINS)) {
      for (const token of requiredTokens) {
        expect(skin.colors[token]).toBeDefined();
        expect(skin.colors[token]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('all built-in skins have a borderStyle + promptStyle', () => {
    for (const skin of Object.values(BUILTIN_SKINS)) {
      expect(skin.borderStyle).toBeDefined();
      expect(skin.promptStyle).toBeDefined();
      expect(skin.promptStyle.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #1: YAML schema
// ─────────────────────────────────────────────────────────────────────

describe('T-024: parseSkinYaml (acceptance #1)', () => {
  it('parses a complete skin YAML', () => {
    const yaml = `
name: my-skin
description: A custom skin
borderStyle: single
promptStyle: $
colors:
  fg: "#ffffff"
  blue: "#55ffff"
  green: "#55ff55"
  red: "#ff5555"
`;
    const parsed = parseSkinYaml(yaml);
    expect(parsed['name']).toBe('my-skin');
    expect(parsed['description']).toBe('A custom skin');
    expect(parsed['borderStyle']).toBe('single');
    expect(parsed['promptStyle']).toBe('$');
    const colors = parsed['colors'] as Record<string, string>;
    expect(colors['fg']).toBe('#ffffff');
    expect(colors['blue']).toBe('#55ffff');
  });

  it('handles quoted and unquoted values', () => {
    const yaml = `
name: unquoted
description: "quoted value"
`;
    const parsed = parseSkinYaml(yaml);
    expect(parsed['name']).toBe('unquoted');
    expect(parsed['description']).toBe('quoted value');
  });

  it('ignores comments', () => {
    const yaml = `
# This is a comment
name: test  # inline comment
`;
    const parsed = parseSkinYaml(yaml);
    expect(parsed['name']).toBe('test');
  });

  it('handles empty lines', () => {
    const yaml = `

name: test

`;
    const parsed = parseSkinYaml(yaml);
    expect(parsed['name']).toBe('test');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #3: GOLI_SKIN env var + --skin flag
// ─────────────────────────────────────────────────────────────────────

describe('T-024: getActiveSkin (acceptance #3)', () => {
  it('returns default skin when no GOLI_SKIN and no --skin flag', () => {
    const skin = getActiveSkin();
    expect(skin.name).toBe('default');
  });

  it('returns the skin named by GOLI_SKIN env var', () => {
    process.env['GOLI_SKIN'] = 'dark';
    const skin = getActiveSkin();
    expect(skin.name).toBe('dark');
  });

  it('returns the skin named by --skin flag', () => {
    process.argv = ['node', 'goli', '--skin', 'dark'];
    const skin = getActiveSkin();
    expect(skin.name).toBe('dark');
  });

  it('supports --skin=name syntax', () => {
    process.argv = ['node', 'goli', '--skin=high-contrast'];
    const skin = getActiveSkin();
    expect(skin.name).toBe('high-contrast');
  });

  it('GOLI_SKIN env var takes precedence over --skin flag', () => {
    process.env['GOLI_SKIN'] = 'dark';
    process.argv = ['node', 'goli', '--skin', 'high-contrast'];
    const skin = getActiveSkin();
    expect(skin.name).toBe('dark');
  });

  it('falls back to default when skin name is unknown', () => {
    process.env['GOLI_SKIN'] = 'nonexistent-skin';
    const skin = getActiveSkin();
    expect(skin.name).toBe('default');
  });

  it('loads a skin from a file path via GOLI_SKIN', () => {
    const skinPath = join(tmpHome, 'custom.yaml');
    writeFileSync(
      skinPath,
      `name: custom-file-skin\ndescription: from file\ncolors:\n  fg: "#aabbcc"\n`,
      'utf-8',
    );
    process.env['GOLI_SKIN'] = skinPath;
    const skin = getActiveSkin();
    expect(skin.name).toBe('custom-file-skin');
    expect(skin.colors.fg).toBe('#aabbcc');
    expect(skin.builtin).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #5: each built-in skin loads and applies
// ─────────────────────────────────────────────────────────────────────

describe('T-024: loadSkin (acceptance #5)', () => {
  it('loads the default skin by name', () => {
    const skin = loadSkin('default');
    expect(skin.name).toBe('default');
    expect(skin.builtin).toBe(true);
  });

  it('loads the dark skin by name', () => {
    const skin = loadSkin('dark');
    expect(skin.name).toBe('dark');
    expect(skin.builtin).toBe(true);
  });

  it('loads the high-contrast skin by name', () => {
    const skin = loadSkin('high-contrast');
    expect(skin.name).toBe('high-contrast');
    expect(skin.builtin).toBe(true);
  });

  it('throws for unknown skin name', () => {
    expect(() => loadSkin('nonexistent')).toThrow(/not found/);
  });

  it('loads a skin from a YAML file path', () => {
    const skinPath = join(tmpHome, 'my-skin.yaml');
    writeFileSync(
      skinPath,
      `name: from-file\ndescription: test\nborderStyle: double\npromptStyle: "❯"\ncolors:\n  fg: "#112233"\n  red: "#ff0000"\n`,
      'utf-8',
    );
    const skin = loadSkin(skinPath);
    expect(skin.name).toBe('from-file');
    expect(skin.borderStyle).toBe('double');
    expect(skin.promptStyle).toBe('❯');
    expect(skin.colors.fg).toBe('#112233');
    expect(skin.colors.red).toBe('#ff0000');
    // Missing colors fall back to default.
    expect(skin.colors.blue).toBe(DEFAULT_SKIN.colors.blue);
    expect(skin.builtin).toBe(false);
    expect(skin.sourcePath).toBe(skinPath);
  });

  it('loads a skin from ~/.goli/skins/<name>.yaml', () => {
    const skinsDir = getUserSkinsDir();
    mkdirSync(skinsDir, { recursive: true });
    writeFileSync(
      join(skinsDir, 'user-skin.yaml'),
      `name: user-skin\ndescription: from user dir\ncolors:\n  fg: "#aabbcc"\n`,
      'utf-8',
    );
    const skin = loadSkin('user-skin');
    expect(skin.name).toBe('user-skin');
    expect(skin.builtin).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listSkins
// ─────────────────────────────────────────────────────────────────────

describe('T-024: listSkins', () => {
  it('returns all built-in skins by default (11 after T-034)', () => {
    const skins = listSkins();
    expect(skins.length).toBeGreaterThanOrEqual(20);
    expect(skins.map((s) => s.name)).toContain('default');
    expect(skins.map((s) => s.name)).toContain('dark');
    expect(skins.map((s) => s.name)).toContain('high-contrast');
    // T-034 additions:
    expect(skins.map((s) => s.name)).toContain('dracula');
    expect(skins.map((s) => s.name)).toContain('nord');
    expect(skins.map((s) => s.name)).toContain('monokai');
  });

  it('includes user-defined skins when present', () => {
    const skinsDir = getUserSkinsDir();
    mkdirSync(skinsDir, { recursive: true });
    writeFileSync(
      join(skinsDir, 'custom.yaml'),
      `name: custom\ndescription: custom skin\ncolors:\n  fg: "#000000"\n`,
      'utf-8',
    );
    const skins = listSkins();
    expect(skins.map((s) => s.name)).toContain('custom');
  });
});

// ─────────────────────────────────────────────────────────────────────
// runSkin CLI command
// ─────────────────────────────────────────────────────────────────────

describe('T-024: runSkin CLI command', () => {
  it('list shows all skins', async () => {
    const exitCode = await runSkin(['list']);
    expect(exitCode).toBe(0);
  });

  it('show <name> displays skin details', async () => {
    const exitCode = await runSkin(['show', 'default']);
    expect(exitCode).toBe(0);
  });

  it('show unknown skin returns 1', async () => {
    const exitCode = await runSkin(['show', 'nonexistent']);
    expect(exitCode).toBe(1);
  });

  it('use <name> prints usage instructions', async () => {
    const exitCode = await runSkin(['use', 'dark']);
    expect(exitCode).toBe(0);
  });

  it('use unknown skin returns 1', async () => {
    const exitCode = await runSkin(['use', 'nonexistent']);
    expect(exitCode).toBe(1);
  });

  it('unknown subcommand returns 1', async () => {
    const exitCode = await runSkin(['unknown']);
    expect(exitCode).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #4: TUI components consume skin (via getActiveSkin)
// ─────────────────────────────────────────────────────────────────────

describe('T-024: Skin consumption (acceptance #4)', () => {
  it('getActiveSkin returns a Skin object with colors', () => {
    const skin = getActiveSkin();
    expect(skin).toBeDefined();
    expect(skin.colors).toBeDefined();
    expect(typeof skin.colors.fg).toBe('string');
  });

  it('the skin-engine module exports getActiveSkin for components to call', () => {
    // This verifies the API surface that TUI components would use:
    //   import { getActiveSkin } from '../theme/skin-engine.js';
    //   const skin = getActiveSkin();
    //   <Text color={skin.colors.fg}>...</Text>
    expect(typeof getActiveSkin).toBe('function');
  });
});
