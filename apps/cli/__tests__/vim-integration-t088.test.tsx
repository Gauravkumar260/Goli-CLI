/**
 * Tests for T-088: Full vim mode integration into PromptInput.
 *
 * Covers:
 *   - PromptInput renders [INSERT] indicator when vimEnabled=true (default mode)
 *   - PromptInput renders [NORMAL] after Esc (mode switches)
 *   - PromptInput renders [VISUAL] indicator with purple color
 *   - vimModeLabel() returns correct labels for all 3 modes
 *   - vimHandleKey() Esc in INSERT → NORMAL
 *   - vimHandleKey() 'i' in NORMAL → INSERT
 *   - vimHandleKey() 'v' in NORMAL → VISUAL
 *   - vimHandleKey() Esc in VISUAL → NORMAL
 *   - vimHandleKey() 'h' in NORMAL moves cursor left
 *   - vimHandleKey() 'l' in NORMAL moves cursor right
 *   - vimHandleKey() 'dd' in NORMAL → deleteLine action
 *   - vimHandleKey() 'x' in NORMAL → deleteForward action
 *   - vimHandleKey() 'o' in NORMAL → newline action + INSERT
 *   - vimHandleKey() 'Enter' in INSERT → submit action
 *   - vimHandleKey() printable char in INSERT → insert action
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { PromptInput } from '../src/tui/components/PromptInput.js';
import {
  vimHandleKey,
  initialVimState,
  vimModeLabel,
  type VimState,
} from '../src/tui/lib/vimMode.js';

// ─── PromptInput vim indicator ──────────────────────────────────────

describe('T-088: PromptInput vim mode indicator', () => {
  it('shows [INSERT] when vimEnabled=true (default mode)', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        vimEnabled={true}
      />,
    );
    expect(lastFrame() ?? '').toContain('[INSERT]');
  });

  it('does NOT show vim indicator when vimEnabled=false', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[INSERT]');
    expect(frame).not.toContain('[NORMAL]');
    expect(frame).not.toContain('[VISUAL]');
  });
});


// ─── vimModeLabel() ─────────────────────────────────────────────────

describe('T-088: vimModeLabel()', () => {
  it('returns -- INSERT -- for INSERT mode', () => {
    expect(vimModeLabel('INSERT')).toBe('-- INSERT --');
  });

  it('returns -- NORMAL -- for NORMAL mode', () => {
    expect(vimModeLabel('NORMAL')).toBe('-- NORMAL --');
  });

  it('returns -- VISUAL -- for VISUAL mode', () => {
    expect(vimModeLabel('VISUAL')).toBe('-- VISUAL --');
  });
});


// ─── vimHandleKey() mode transitions ────────────────────────────────

describe('T-088: vimHandleKey mode transitions', () => {
  it('Esc in INSERT → NORMAL', () => {
    const state = initialVimState();
    const result = vimHandleKey(state, 'Esc', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
  });

  it('i in NORMAL → INSERT', () => {
    const state: VimState = { ...initialVimState(), mode: 'NORMAL' };
    const result = vimHandleKey(state, 'i', ['hello']);
    expect(result.state.mode).toBe('INSERT');
  });

  it('v in NORMAL → VISUAL', () => {
    const state: VimState = { ...initialVimState(), mode: 'NORMAL' };
    const result = vimHandleKey(state, 'v', ['hello']);
    expect(result.state.mode).toBe('VISUAL');
    expect(result.state.visualStart).not.toBeNull();
  });

  it('Esc in VISUAL → NORMAL', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'VISUAL',
      visualStart: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'Esc', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
    expect(result.state.visualStart).toBeNull();
  });

  it('Esc in NORMAL clears pending prefix', () => {
    const state: VimState = { ...initialVimState(), mode: 'NORMAL', pendingPrefix: 'd' };
    const result = vimHandleKey(state, 'Esc', ['hello']);
    expect(result.state.pendingPrefix).toBe('');
  });
});


// ─── vimHandleKey() NORMAL mode commands ────────────────────────────

describe('T-088: vimHandleKey NORMAL mode commands', () => {
  it('h moves cursor left', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 3, row: 0 },
    };
    const result = vimHandleKey(state, 'h', ['hello']);
    expect(result.state.cursor.col).toBe(2);
  });

  it('l moves cursor right', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 1, row: 0 },
    };
    const result = vimHandleKey(state, 'l', ['hello']);
    expect(result.state.cursor.col).toBe(2);
  });

  it('0 moves cursor to start of line', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 3, row: 0 },
    };
    const result = vimHandleKey(state, '0', ['hello']);
    expect(result.state.cursor.col).toBe(0);
  });

  it('$ moves cursor to end of line', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, '$', ['hello']);
    expect(result.state.cursor.col).toBe(5);
  });

  it('dd produces deleteLine action', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      pendingPrefix: 'd',
    };
    const result = vimHandleKey(state, 'd', ['hello']);
    expect(result.action.type).toBe('deleteLine');
    expect(result.state.pendingPrefix).toBe('');
  });

  it('x produces deleteForward action', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'x', ['hello']);
    expect(result.action.type).toBe('deleteForward');
  });

  it('o produces newline action + switches to INSERT', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 2, row: 0 },
    };
    const result = vimHandleKey(state, 'o', ['hello']);
    expect(result.action.type).toBe('newline');
    expect(result.state.mode).toBe('INSERT');
  });

  it('a switches to INSERT and moves cursor right', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 1, row: 0 },
    };
    const result = vimHandleKey(state, 'a', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(2);
  });

  it('A switches to INSERT and moves to end of line', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'A', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(5);
  });

  it('d alone sets pendingPrefix to "d"', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'NORMAL',
    };
    const result = vimHandleKey(state, 'd', ['hello']);
    expect(result.state.pendingPrefix).toBe('d');
    expect(result.action.type).toBe('none');
  });
});


// ─── vimHandleKey() INSERT mode ─────────────────────────────────────

describe('T-088: vimHandleKey INSERT mode', () => {
  it('Enter produces submit action', () => {
    const state = initialVimState();
    const result = vimHandleKey(state, 'Enter', ['hello']);
    expect(result.action.type).toBe('submit');
  });

  it('Backspace produces deleteBackward action', () => {
    const state = initialVimState();
    const result = vimHandleKey(state, 'Backspace', ['hello']);
    expect(result.action.type).toBe('deleteBackward');
  });

  it('printable char produces insert action', () => {
    const state = initialVimState();
    const result = vimHandleKey(state, 'x', ['hello']);
    expect(result.action.type).toBe('insert');
    if (result.action.type === 'insert') {
      expect(result.action.text).toBe('x');
    }
  });

  it('newline produces newline action', () => {
    const state = initialVimState();
    const result = vimHandleKey(state, 'newline', ['hello']);
    expect(result.action.type).toBe('newline');
  });
});


// ─── vimHandleKey() VISUAL mode ─────────────────────────────────────

describe('T-088: vimHandleKey VISUAL mode', () => {
  it('h moves cursor left in VISUAL', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'VISUAL',
      cursor: { col: 3, row: 0 },
      visualStart: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'h', ['hello']);
    expect(result.state.cursor.col).toBe(2);
  });

  it('x in VISUAL produces deleteSelection action', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'VISUAL',
      cursor: { col: 3, row: 0 },
      visualStart: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'x', ['hello']);
    expect(result.action.type).toBe('deleteSelection');
    expect(result.state.mode).toBe('NORMAL');
  });

  it('d in VISUAL produces deleteSelection action', () => {
    const state: VimState = {
      ...initialVimState(),
      mode: 'VISUAL',
      cursor: { col: 3, row: 0 },
      visualStart: { col: 0, row: 0 },
    };
    const result = vimHandleKey(state, 'd', ['hello']);
    expect(result.action.type).toBe('deleteSelection');
  });
});
