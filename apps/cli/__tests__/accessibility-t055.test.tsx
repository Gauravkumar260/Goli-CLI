/**
 * Unit tests for T-055 — Accessibility improvements (loop run 6, iter 3).
 *
 * Verifies:
 *  1. NO_COLOR env var activates the no-color skin (all colors blank).
 *  2. /theme no-color loads the NO_COLOR_SKIN.
 *  3. Spinner renders altText in screen-reader mode (no animation).
 *  4. Spinner renders the frame in visual mode.
 *  5. Spinner gradient cycles through 5 brand colors.
 *  6. textConstants exports both visual + screen-reader variants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  NO_COLOR_SKIN,
  loadSkin,
  getActiveSkin,
  BUILTIN_SKIN_NAMES,
} from '../src/tui/theme/skin-engine.js';
import { Spinner, GRADIENT_PALETTE, getSpinnerFrames } from '../src/tui/components/Spinner.js';
import {
  STATUS,
  SCREEN_READER_STATUS,
  LOADING_PHRASES,
  WITTY_PHRASES,
  SCREEN_READER_LOADING,
  SCREEN_READER_USER_PREFIX,
  PERMISSION,
  SCREEN_READER_PERMISSION,
  WELCOME_TIP,
  SCREEN_READER_WELCOME,
  TIER_LEGEND,
  ERROR_PREFIX,
  SCREEN_READER_ERROR_PREFIX,
  getStatusText,
  getLoadingText,
} from '../src/tui/lib/textConstants.js';

// Save env so we can restore individual keys after each test.
const SAVED_NO_COLOR = process.env['NO_COLOR'];
const SAVED_GOLI_SKIN = process.env['GOLI_SKIN'];

describe('T-055: NO_COLOR_SKIN — definition', () => {
  it('is named "no-color"', () => {
    expect(NO_COLOR_SKIN.name).toBe('no-color');
  });

  it('has all blank colors (empty strings)', () => {
    const colors = NO_COLOR_SKIN.colors;
    expect(colors.fg).toBe('');
    expect(colors.blue).toBe('');
    expect(colors.green).toBe('');
    expect(colors.red).toBe('');
    expect(colors.yellow).toBe('');
    expect(colors.purple).toBe('');
    expect(colors.teal).toBe('');
    expect(colors.gray).toBe('');
    expect(colors.border).toBe('');
    expect(colors.orange).toBe('');
  });

  it('has builtin: true', () => {
    expect(NO_COLOR_SKIN.builtin).toBe(true);
  });

  it('is NOT in BUILTIN_SKIN_NAMES (loaded via special case)', () => {
    // The no-color skin is loaded via the special case in loadSkin(), not
    // via BUILTIN_SKIN_NAMES, so it doesn't pollute the regular theme list.
    expect(BUILTIN_SKIN_NAMES).not.toContain('no-color');
  });
});

describe('T-055: loadSkin — no-color special case', () => {
  it('loadSkin("no-color") returns NO_COLOR_SKIN', () => {
    expect(loadSkin('no-color')).toBe(NO_COLOR_SKIN);
  });

  it('loadSkin is case-insensitive for "no-color"', () => {
    expect(loadSkin('No-Color')).toBe(NO_COLOR_SKIN);
    expect(loadSkin('NO-COLOR')).toBe(NO_COLOR_SKIN);
  });
});

describe('T-055: getActiveSkin — NO_COLOR env var precedence', () => {
  beforeEach(() => {
    // Clear skin-related env vars so tests start from a known state.
    delete process.env['NO_COLOR'];
    delete process.env['GOLI_SKIN'];
  });

  afterEach(() => {
    // Restore individual keys (don't replace process.env wholesale).
    if (SAVED_NO_COLOR !== undefined) {
      process.env['NO_COLOR'] = SAVED_NO_COLOR;
    } else {
      delete process.env['NO_COLOR'];
    }
    if (SAVED_GOLI_SKIN !== undefined) {
      process.env['GOLI_SKIN'] = SAVED_GOLI_SKIN;
    } else {
      delete process.env['GOLI_SKIN'];
    }
  });

  it('returns NO_COLOR_SKIN when NO_COLOR=1 is set', () => {
    process.env['NO_COLOR'] = '1';
    expect(getActiveSkin()).toBe(NO_COLOR_SKIN);
  });

  it('returns NO_COLOR_SKIN when NO_COLOR is set to any non-empty value', () => {
    process.env['NO_COLOR'] = 'true';
    expect(getActiveSkin()).toBe(NO_COLOR_SKIN);
  });

  it('returns DEFAULT_SKIN when NO_COLOR is empty string', () => {
    process.env['NO_COLOR'] = '';
    expect(getActiveSkin().name).toBe('default');
  });

  it('returns DEFAULT_SKIN when NO_COLOR is unset', () => {
    expect(getActiveSkin().name).toBe('default');
  });

  it('NO_COLOR takes precedence over GOLI_SKIN', () => {
    process.env['NO_COLOR'] = '1';
    process.env['GOLI_SKIN'] = 'dracula';
    expect(getActiveSkin()).toBe(NO_COLOR_SKIN);
  });
});

describe('T-055: Spinner — screen-reader fallback (altText)', () => {
  // Note: useIsScreenReaderEnabled reads from detectCapabilities() which
  // checks process.env. We mock the hook to test both modes directly.

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders altText in screen-reader mode (no animation, no frame chars)', () => {
    vi.doMock('../src/tui/hooks/useIsScreenReaderEnabled.js', () => ({
      useIsScreenReaderEnabled: () => true,
      isScreenReaderEnabled: () => true,
    }));
    // Re-import Spinner with the mock applied.
    return import('../src/tui/components/Spinner.js?sr=1').then((mod) => {
      const { lastFrame } = render(<mod.Spinner altText="Loading (please wait)" label="Working" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Loading (please wait)');
      expect(frame).toContain('Working');
      // No braille-dots frames should appear (those are only for visual mode).
      expect(frame).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    });
  });

  it('renders just label in SR mode when altText is omitted', () => {
    vi.doMock('../src/tui/hooks/useIsScreenReaderEnabled.js', () => ({
      useIsScreenReaderEnabled: () => true,
      isScreenReaderEnabled: () => true,
    }));
    return import('../src/tui/components/Spinner.js?sr=2').then((mod) => {
      const { lastFrame } = render(<mod.Spinner label="Working" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Working');
    });
  });

  it('renders animated frame in visual mode (default)', () => {
    vi.doMock('../src/tui/hooks/useIsScreenReaderEnabled.js', () => ({
      useIsScreenReaderEnabled: () => false,
      isScreenReaderEnabled: () => false,
    }));
    return import('../src/tui/components/Spinner.js?sr=3').then((mod) => {
      const { lastFrame } = render(<mod.Spinner label="Working" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Working');
      // Visual mode should show a braille-dot frame (default style: dots).
      expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\←↖↑↗→↘↓↙⠁⠂⠄▖▘▝▗]/);
    });
  });
});

describe('T-055: Spinner — gradient prop', () => {
  it('GRADIENT_PALETTE has 5 colors', () => {
    expect(GRADIENT_PALETTE.length).toBe(5);
  });

  it('GRADIENT_PALETTE colors are hex strings', () => {
    for (const c of GRADIENT_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('Spinner accepts gradient prop without crashing', () => {
    vi.doMock('../src/tui/hooks/useIsScreenReaderEnabled.js', () => ({
      useIsScreenReaderEnabled: () => false,
      isScreenReaderEnabled: () => false,
    }));
    return import('../src/tui/components/Spinner.js?sr=4').then((mod) => {
      const { lastFrame } = render(<mod.Spinner gradient label="Working" />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Working');
    });
  });
});

describe('T-055: Spinner — getSpinnerFrames still works', () => {
  it('returns frames for dots style', () => {
    const frames = getSpinnerFrames('dots');
    expect(frames.length).toBe(10);
    expect(frames[0]).toBe('⠋');
  });

  it('returns frames for all styles', () => {
    const styles = ['dots', 'line', 'arrow', 'bounce', 'triangle'] as const;
    for (const s of styles) {
      const frames = getSpinnerFrames(s);
      expect(frames.length).toBeGreaterThan(0);
    }
  });
});

describe('T-055: textConstants — STATUS + SCREEN_READER_STATUS', () => {
  it('STATUS has compact labels', () => {
    expect(STATUS.READY).toBe('Ready');
    expect(STATUS.BUSY).toBe('Busy');
    expect(STATUS.THINKING).toBe('Thinking');
  });

  it('SCREEN_READER_STATUS has verbose labels', () => {
    expect(SCREEN_READER_STATUS.READY).toContain('ready');
    expect(SCREEN_READER_STATUS.READY).toContain('Enter');
    expect(SCREEN_READER_STATUS.BUSY).toContain('busy');
    expect(SCREEN_READER_STATUS.BUSY).toContain('Escape');
  });

  it('STATUS and SCREEN_READER_STATUS have the same keys', () => {
    const visualKeys = Object.keys(STATUS).sort();
    const srKeys = Object.keys(SCREEN_READER_STATUS).sort();
    expect(visualKeys).toEqual(srKeys);
  });
});

describe('T-055: textConstants — LOADING_PHRASES + WITTY_PHRASES', () => {
  it('LOADING_PHRASES is non-empty', () => {
    expect(LOADING_PHRASES.length).toBeGreaterThan(0);
  });

  it('WITTY_PHRASES is non-empty (humor for delight)', () => {
    expect(WITTY_PHRASES.length).toBeGreaterThan(0);
  });

  it('SCREEN_READER_LOADING is a complete sentence', () => {
    expect(SCREEN_READER_LOADING).toMatch(/loading/i);
    expect(SCREEN_READER_LOADING).toMatch(/wait/i);
  });

  it('SCREEN_READER_USER_PREFIX announces "Goli-CLI prompt"', () => {
    expect(SCREEN_READER_USER_PREFIX).toContain('Goli-CLI');
    expect(SCREEN_READER_USER_PREFIX).toContain('prompt');
  });
});

describe('T-055: textConstants — PERMISSION + SCREEN_READER_PERMISSION', () => {
  it('PERMISSION has y/n/a/v/e keys', () => {
    expect(PERMISSION.APPROVE_KEY).toBe('y');
    expect(PERMISSION.DENY_KEY).toBe('n');
    expect(PERMISSION.ALWAYS_KEY).toBe('a');
    expect(PERMISSION.VIEW_KEY).toBe('v');
    expect(PERMISSION.EDIT_KEY).toBe('e');
  });

  it('SCREEN_READER_PERMISSION.PROMPT spells out the keys', () => {
    expect(SCREEN_READER_PERMISSION.PROMPT).toContain('Y');
    expect(SCREEN_READER_PERMISSION.PROMPT).toContain('N');
    expect(SCREEN_READER_PERMISSION.PROMPT).toContain('A');
  });
});

describe('T-055: textConstants — WELCOME + TIER_LEGEND', () => {
  it('WELCOME_TIP is short and visual', () => {
    expect(WELCOME_TIP).toContain('Welcome');
    expect(WELCOME_TIP).toContain('/help');
  });

  it('SCREEN_READER_WELCOME spells out /help as "slash and help"', () => {
    expect(SCREEN_READER_WELCOME).toContain('Welcome');
    expect(SCREEN_READER_WELCOME).toContain('slash');
    expect(SCREEN_READER_WELCOME).toContain('help');
  });

  it('TIER_LEGEND documents all 5 tiers', () => {
    expect(TIER_LEGEND).toContain('T0');
    expect(TIER_LEGEND).toContain('T1');
    expect(TIER_LEGEND).toContain('T2');
    expect(TIER_LEGEND).toContain('T3');
    expect(TIER_LEGEND).toContain('BLK');
  });
});

describe('T-055: textConstants — ERROR_PREFIX + SCREEN_READER_ERROR_PREFIX', () => {
  it('ERROR_PREFIX is compact', () => {
    expect(ERROR_PREFIX).toBe('Error');
  });

  it('SCREEN_READER_ERROR_PREFIX has trailing colon (verbose)', () => {
    expect(SCREEN_READER_ERROR_PREFIX).toBe('Error:');
  });
});

describe('T-055: textConstants — helper functions', () => {
  it('getStatusText returns visual variant in visual mode', () => {
    expect(getStatusText('visual', 'READY')).toBe('Ready');
    expect(getStatusText('visual', 'BUSY')).toBe('Busy');
  });

  it('getStatusText returns SR variant in screen-reader mode', () => {
    expect(getStatusText('screen-reader', 'READY')).toContain('ready');
    expect(getStatusText('screen-reader', 'READY')).toContain('Enter');
  });

  it('getLoadingText returns SR loading text in SR mode', () => {
    expect(getLoadingText('screen-reader')).toBe(SCREEN_READER_LOADING);
  });

  it('getLoadingText cycles through LOADING_PHRASES in visual mode', () => {
    expect(getLoadingText('visual', 0)).toBe(LOADING_PHRASES[0]);
    expect(getLoadingText('visual', 1)).toBe(LOADING_PHRASES[1]);
    // Wraps around.
    expect(getLoadingText('visual', LOADING_PHRASES.length)).toBe(LOADING_PHRASES[0]);
  });
});
