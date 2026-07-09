/**
 * Tests for T-087: Apply skin borderStyle (components no longer hardcode 'round').
 *
 * Covers:
 *   - B.borderStyle defaults to 'round'
 *   - getBorderStyle() returns the current border style
 *   - applyBorderStyle() mutates B.borderStyle
 *   - applyBorderStyle() returns true when changed
 *   - applyBorderStyle() returns false when unchanged
 *   - applySkinToTokens() applies borderStyle from skin
 *   - All builtin skins have a valid borderStyle
 *   - Switching skins changes the border style
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  T,
  B,
  DEFAULT_PALETTE,
  DEFAULT_BORDER_STYLE,
  applySkinToTokens,
  applyBorderStyle,
  getBorderStyle,
  getThemeVersion,
} from '../../packages/cli/src/tui/theme/tokens.js';
import { BUILTIN_SKIN_NAMES, loadSkin, type Skin } from '../../packages/cli/src/tui/theme/skin-engine.js';

beforeEach(() => {
  Object.assign(T, DEFAULT_PALETTE);
  B.borderStyle = DEFAULT_BORDER_STYLE;
});

afterEach(() => {
  Object.assign(T, DEFAULT_PALETTE);
  B.borderStyle = DEFAULT_BORDER_STYLE;
});

// ─── B token + getBorderStyle() ─────────────────────────────────────

describe('T-087: B token + getBorderStyle()', () => {
  it('B.borderStyle defaults to "round"', () => {
    expect(B.borderStyle).toBe('round');
  });

  it('getBorderStyle() returns the current border style', () => {
    expect(getBorderStyle()).toBe('round');
    B.borderStyle = 'single';
    expect(getBorderStyle()).toBe('single');
  });

  it('DEFAULT_BORDER_STYLE is "round"', () => {
    expect(DEFAULT_BORDER_STYLE).toBe('round');
  });
});


// ─── applyBorderStyle() ─────────────────────────────────────────────

describe('T-087: applyBorderStyle()', () => {
  it('mutates B.borderStyle', () => {
    applyBorderStyle('single');
    expect(B.borderStyle).toBe('single');
  });

  it('returns true when border style changed', () => {
    const changed = applyBorderStyle('bold');
    expect(changed).toBe(true);
  });

  it('returns false when border style unchanged', () => {
    applyBorderStyle('single');
    const changed = applyBorderStyle('single'); // same value
    expect(changed).toBe(false);
  });

  it('can reset to default', () => {
    applyBorderStyle('single');
    expect(B.borderStyle).toBe('single');
    applyBorderStyle(DEFAULT_BORDER_STYLE);
    expect(B.borderStyle).toBe('round');
  });
});


// ─── applySkinToTokens() applies borderStyle ────────────────────────

describe('T-087: applySkinToTokens() applies borderStyle', () => {
  it('applies borderStyle from skin', () => {
    applySkinToTokens({
      colors: { red: '#ff0000' },
      borderStyle: 'single',
    });
    expect(B.borderStyle).toBe('single');
  });

  it('does NOT change borderStyle when borderStyle is undefined', () => {
    B.borderStyle = 'bold';
    applySkinToTokens({
      colors: { red: '#ff0000' },
      // borderStyle omitted
    });
    expect(B.borderStyle).toBe('bold');
  });

  it('bumps theme version when border style changes', () => {
    const before = getThemeVersion();
    applySkinToTokens({
      colors: {},
      borderStyle: 'single',
    });
    const after = getThemeVersion();
    expect(after).toBe(before + 1);
  });
});


// ─── All builtin skins have valid borderStyle ───────────────────────

describe('T-087: all builtin skins have valid borderStyle', () => {
  const VALID_BORDER_STYLES = ['single', 'double', 'round', 'bold', 'singleDouble', 'classic', 'arrow'];

  it('every builtin skin has a borderStyle from the valid set', () => {
    for (const name of BUILTIN_SKIN_NAMES) {
      const skin: Skin = loadSkin(name);
      expect(VALID_BORDER_STYLES).toContain(skin.borderStyle);
    }
  });

  it('applying any builtin skin does not throw', () => {
    for (const name of BUILTIN_SKIN_NAMES) {
      const skin = loadSkin(name);
      expect(() => applySkinToTokens(skin)).not.toThrow();
      // Reset for next iteration
      Object.assign(T, DEFAULT_PALETTE);
      B.borderStyle = DEFAULT_BORDER_STYLE;
    }
  });

  it('default skin has borderStyle "round"', () => {
    const skin = loadSkin('default');
    expect(skin.borderStyle).toBe('round');
  });

  it('at least one builtin skin uses a non-round border style', () => {
    // Verify that different skins actually have different border styles
    // (otherwise the feature has no visible effect).
    const borderStyles = new Set<string>();
    for (const name of BUILTIN_SKIN_NAMES) {
      const skin = loadSkin(name);
      borderStyles.add(skin.borderStyle);
    }
    expect(borderStyles.size).toBeGreaterThan(1);
  });
});


// ─── Switching skins changes the border style ───────────────────────

describe('T-087: switching skins changes border style', () => {
  it('switching from default to a skin with "single" border updates B', () => {
    // Find a skin with 'single' borderStyle
    let singleSkinName: string | null = null;
    for (const name of BUILTIN_SKIN_NAMES) {
      const skin = loadSkin(name);
      if (skin.borderStyle === 'single') {
        singleSkinName = name;
        break;
      }
    }
    expect(singleSkinName).not.toBeNull();
    const skin = loadSkin(singleSkinName!);
    applySkinToTokens(skin);
    expect(B.borderStyle).toBe('single');
  });
});
