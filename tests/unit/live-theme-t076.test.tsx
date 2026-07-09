/**
 * Tests for T-076: Live theme switching (hot-reload).
 *
 * Covers:
 *   - applySkinToTokens() mutates T properties in place
 *   - applySkinToTokens() returns true when colors changed
 *   - applySkinToTokens() returns false when colors unchanged
 *   - applySkinToTokens() handles partial color objects
 *   - getThemeVersion() increments after applySkinToTokens()
 *   - subscribeToThemeVersion() fires on changes
 *   - subscribeToThemeVersion() unsubscribe works
 *   - DEFAULT_PALETTE can reset T to original
 *   - useThemeVersion() hook returns current version
 *   - All builtin skins can be applied without error
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import {
  T,
  DEFAULT_PALETTE,
  applySkinToTokens,
  getThemeVersion,
  subscribeToThemeVersion,
} from '../../packages/cli/src/tui/theme/tokens.js';
import { useThemeVersion } from '../../packages/cli/src/tui/hooks/useThemeVersion.js';
import { BUILTIN_SKIN_NAMES, loadSkin } from '../../packages/cli/src/tui/theme/skin-engine.js';

// Save/restore the palette around each test so mutations don't leak.
beforeEach(() => {
  Object.assign(T, DEFAULT_PALETTE);
});

afterEach(() => {
  Object.assign(T, DEFAULT_PALETTE);
});

// ─── applySkinToTokens() ────────────────────────────────────────────

describe('T-076: applySkinToTokens()', () => {
  it('mutates T properties in place', () => {
    const originalRed = T.red;
    applySkinToTokens({ colors: { red: '#ff0000' } });
    expect(T.red).toBe('#ff0000');
    expect(T.red).not.toBe(originalRed);
  });

  it('returns true when colors changed', () => {
    const changed = applySkinToTokens({ colors: { blue: '#0000ff' } });
    expect(changed).toBe(true);
  });

  it('returns false when colors unchanged', () => {
    // Apply the current palette — should report no change.
    const changed = applySkinToTokens({ colors: { red: T.red } });
    expect(changed).toBe(false);
  });

  it('handles partial color objects (only specified colors change)', () => {
    const originalBlue = T.blue;
    applySkinToTokens({ colors: { red: '#ff0000' } });
    expect(T.red).toBe('#ff0000');
    expect(T.blue).toBe(originalBlue); // unchanged
  });

  it('handles empty colors object', () => {
    const changed = applySkinToTokens({ colors: {} });
    expect(changed).toBe(false);
  });

  it('applies all 10 color tokens when provided', () => {
    applySkinToTokens({
      colors: {
        fg: '#111111',
        blue: '#222222',
        green: '#333333',
        red: '#444444',
        yellow: '#555555',
        purple: '#666666',
        teal: '#777777',
        gray: '#888888',
        border: '#999999',
        orange: '#aaaaaa',
      },
    });
    expect(T.fg).toBe('#111111');
    expect(T.blue).toBe('#222222');
    expect(T.green).toBe('#333333');
    expect(T.red).toBe('#444444');
    expect(T.yellow).toBe('#555555');
    expect(T.purple).toBe('#666666');
    expect(T.teal).toBe('#777777');
    expect(T.gray).toBe('#888888');
    expect(T.border).toBe('#999999');
    expect(T.orange).toBe('#aaaaaa');
  });
});


// ─── getThemeVersion() + subscribeToThemeVersion() ──────────────────

describe('T-076: theme version counter', () => {
  it('getThemeVersion() increments after applySkinToTokens()', () => {
    const before = getThemeVersion();
    applySkinToTokens({ colors: { red: '#abcdef' } });
    const after = getThemeVersion();
    expect(after).toBe(before + 1);
  });

  it('does NOT increment when colors unchanged', () => {
    const before = getThemeVersion();
    applySkinToTokens({ colors: { red: T.red } }); // same value
    const after = getThemeVersion();
    expect(after).toBe(before);
  });

  it('subscribeToThemeVersion() fires on changes', () => {
    let calls = 0;
    const unsub = subscribeToThemeVersion(() => { calls++; });
    applySkinToTokens({ colors: { blue: '#aabbcc' } });
    expect(calls).toBe(1);
    applySkinToTokens({ colors: { green: '#ddeeff' } });
    expect(calls).toBe(2);
    unsub();
  });

  it('subscribeToThemeVersion() does NOT fire when unchanged', () => {
    let calls = 0;
    const unsub = subscribeToThemeVersion(() => { calls++; });
    applySkinToTokens({ colors: { red: T.red } }); // same value
    expect(calls).toBe(0);
    unsub();
  });

  it('unsubscribe stops further notifications', () => {
    let calls = 0;
    const unsub = subscribeToThemeVersion(() => { calls++; });
    applySkinToTokens({ colors: { red: '#111111' } });
    expect(calls).toBe(1);
    unsub();
    applySkinToTokens({ colors: { red: '#222222' } });
    expect(calls).toBe(1); // no additional call
  });
});


// ─── DEFAULT_PALETTE reset ──────────────────────────────────────────

describe('T-076: DEFAULT_PALETTE reset', () => {
  it('can restore T to the original Tokyo Night Dark palette', () => {
    // Mutate everything
    applySkinToTokens({ colors: {
      fg: '#000000', blue: '#000000', green: '#000000', red: '#000000',
      yellow: '#000000', purple: '#000000', teal: '#000000', gray: '#000000',
      border: '#000000', orange: '#000000',
    }});
    expect(T.red).toBe('#000000');
    // Reset
    Object.assign(T, DEFAULT_PALETTE);
    expect(T.fg).toBe('#c0caf5');
    expect(T.red).toBe('#f7768e');
    expect(T.blue).toBe('#7aa2f7');
  });
});


// ─── All builtin skins can be applied ───────────────────────────────

describe('T-076: all builtin skins apply without error', () => {
  it('every builtin skin can be loaded and applied', () => {
    for (const name of BUILTIN_SKIN_NAMES) {
      const skin = loadSkin(name);
      expect(() => applySkinToTokens(skin)).not.toThrow();
      // Verify at least the fg color is set
      expect(T.fg.length).toBeGreaterThan(0);
      // Reset for next iteration
      Object.assign(T, DEFAULT_PALETTE);
    }
  });
});


// ─── useThemeVersion() hook ─────────────────────────────────────────

describe('T-076: useThemeVersion() hook', () => {
  function HookTestComponent(): React.ReactElement {
    const version = useThemeVersion();
    return React.createElement('Text', null, `version=${version}`);
  }

  it('returns the current theme version', () => {
    const { lastFrame } = render(React.createElement(HookTestComponent));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('version=');
  });

  it('updates when applySkinToTokens() is called (version increments)', () => {
    // The hook subscribes to theme version changes. We verify the
    // subscription mechanism works by checking that applySkinToTokens
    // increments the global version counter (which the hook reads).
    const beforeVersion = getThemeVersion();
    applySkinToTokens({ colors: { red: '#abcdef' } });
    const afterVersion = getThemeVersion();
    expect(afterVersion).toBe(beforeVersion + 1);

    // Render the hook component — it should show the updated version.
    const { lastFrame } = render(React.createElement(HookTestComponent));
    const frame = lastFrame() ?? '';
    expect(frame).toContain(`version=${afterVersion}`);
  });
});
