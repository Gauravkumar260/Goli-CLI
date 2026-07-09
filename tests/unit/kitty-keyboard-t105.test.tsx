/**
 * Tests for T-105: Kitty keyboard protocol detection.
 *
 * Covers:
 *   - useKittyKeyboardProtocol hook exports correctly
 *   - isKittyCapable() returns false for no env vars
 *   - isKittyCapable() returns true for kitty TERM_PROGRAM
 *   - isKittyCapable() returns true for ghostty
 *   - isKittyCapable() returns true for WezTerm
 *   - isKittyCapable() returns true for foot
 *   - isKittyCapable() returns true for TERM=kitty
 *   - isKittyCapable() returns false for xterm
 *   - Hook renders without crashing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { useKittyKeyboardProtocol, isKittyCapable } from '../../packages/cli/src/tui/hooks/useKittyKeyboardProtocol.js';

// Save/restore env vars.
const origTermProgram = process.env['TERM_PROGRAM'];
const origTerm = process.env['TERM'];

beforeEach(() => {
  delete process.env['TERM_PROGRAM'];
  delete process.env['TERM'];
});

afterEach(() => {
  if (origTermProgram !== undefined) process.env['TERM_PROGRAM'] = origTermProgram;
  else delete process.env['TERM_PROGRAM'];
  if (origTerm !== undefined) process.env['TERM'] = origTerm;
  else delete process.env['TERM'];
});

// ─── Module exports ─────────────────────────────────────────────────

describe('T-105: module exports', () => {
  it('useKittyKeyboardProtocol is a function', () => {
    expect(typeof useKittyKeyboardProtocol).toBe('function');
  });

  it('isKittyCapable is a function', () => {
    expect(typeof isKittyCapable).toBe('function');
  });
});


// ─── isKittyCapable() ───────────────────────────────────────────────

describe('T-105: isKittyCapable()', () => {
  it('returns false when no env vars are set', () => {
    expect(isKittyCapable()).toBe(false);
  });

  it('returns true for TERM_PROGRAM=kitty', () => {
    process.env['TERM_PROGRAM'] = 'kitty';
    expect(isKittyCapable()).toBe(true);
  });

  it('returns true for TERM_PROGRAM=ghostty', () => {
    process.env['TERM_PROGRAM'] = 'ghostty';
    expect(isKittyCapable()).toBe(true);
  });

  it('returns true for TERM_PROGRAM=WezTerm', () => {
    process.env['TERM_PROGRAM'] = 'WezTerm';
    expect(isKittyCapable()).toBe(true);
  });

  it('returns true for TERM_PROGRAM=foot', () => {
    process.env['TERM_PROGRAM'] = 'foot';
    expect(isKittyCapable()).toBe(true);
  });

  it('returns true for TERM includes kitty', () => {
    process.env['TERM'] = 'xterm-kitty';
    expect(isKittyCapable()).toBe(true);
  });

  it('returns false for TERM=xterm-256color', () => {
    process.env['TERM'] = 'xterm-256color';
    expect(isKittyCapable()).toBe(false);
  });

  it('returns false for TERM_PROGRAM=vscode', () => {
    process.env['TERM_PROGRAM'] = 'vscode';
    expect(isKittyCapable()).toBe(false);
  });
});


// ─── Hook rendering ─────────────────────────────────────────────────

describe('T-105: useKittyKeyboardProtocol hook rendering', () => {
  it('renders without crashing', () => {
    function TestComponent(): React.ReactElement {
      const state = useKittyKeyboardProtocol(false); // don't enable
      return React.createElement('Text', null, `s=${state.supported} e=${state.enabled}`);
    }
    const { lastFrame } = render(React.createElement(TestComponent));
    expect(lastFrame() ?? '').toContain('s=');
  });

  it('initial state is unsupported + disabled', () => {
    function TestComponent(): React.ReactElement {
      const state = useKittyKeyboardProtocol(false);
      return React.createElement('Text', null, `s=${state.supported} e=${state.enabled}`);
    }
    const { lastFrame } = render(React.createElement(TestComponent));
    // Initial state (before detection completes) is false/false.
    expect(lastFrame() ?? '').toContain('s=false');
  });
});
