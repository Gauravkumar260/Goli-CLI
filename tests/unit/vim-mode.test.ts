/**
 * Unit tests for T-047 — Vim mode in PromptInput.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. New module packages/cli/src/tui/lib/vimMode.ts with mode state machine.
 *  2. Insert mode (default): normal typing.
 *  3. Normal mode (Esc): h/j/k/l navigation, i to insert, dd to delete line.
 *  4. Visual mode (v): selection with motion.
 *  5. Mode indicator in PromptInput (INSERT/NORMAL/VISUAL).
 *  6. Tests verify mode transitions + basic motions.
 *
 * Comparison reference: gemini-cli InputPrompt has full vim mode via
 * VimModeContext.
 */
import { describe, it, expect } from 'vitest';

import {
  vimHandleKey,
  initialVimState,
  vimModeLabel,
  type VimState,
  type VimMode,
} from '../../packages/cli/src/tui/lib/vimMode.js';

describe('T-047: vimMode — initial state (AC #1, #2)', () => {
  it('initial state is INSERT mode', () => {
    const s = initialVimState();
    expect(s.mode).toBe('INSERT');
  });

  it('initial cursor is at (0, 0)', () => {
    const s = initialVimState();
    expect(s.cursor).toEqual({ col: 0, row: 0 });
  });

  it('initial visualStart is null', () => {
    const s = initialVimState();
    expect(s.visualStart).toBeNull();
  });

  it('initial pendingPrefix is empty', () => {
    const s = initialVimState();
    expect(s.pendingPrefix).toBe('');
  });
});

describe('T-047: INSERT mode (AC #2)', () => {
  it('typing a char produces insert action', () => {
    const s = initialVimState();
    const result = vimHandleKey(s, 'a', ['']);
    expect(result.action).toEqual({ type: 'insert', text: 'a' });
  });

  it('Enter produces submit action', () => {
    const s = initialVimState();
    const result = vimHandleKey(s, 'Enter', ['hello']);
    expect(result.action).toEqual({ type: 'submit' });
  });

  it('Backspace produces deleteBackward action', () => {
    const s = initialVimState();
    const result = vimHandleKey(s, 'Backspace', ['hello']);
    expect(result.action).toEqual({ type: 'deleteBackward' });
  });

  it('Esc switches to NORMAL mode', () => {
    const s = initialVimState();
    const result = vimHandleKey(s, 'Esc', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
  });

  it('Esc moves cursor left by 1 (vim convention)', () => {
    const s: VimState = { mode: 'INSERT', cursor: { col: 3, row: 0 }, visualStart: null, pendingPrefix: '' };
    const result = vimHandleKey(s, 'Esc', ['hello']);
    expect(result.state.cursor.col).toBe(2);
  });

  it('Esc at col 0 does not move cursor negative', () => {
    const s: VimState = { mode: 'INSERT', cursor: { col: 0, row: 0 }, visualStart: null, pendingPrefix: '' };
    const result = vimHandleKey(s, 'Esc', ['hello']);
    expect(result.state.cursor.col).toBe(0);
  });
});

describe('T-047: NORMAL mode navigation (AC #3)', () => {
  const normalState: VimState = {
    mode: 'NORMAL',
    cursor: { col: 2, row: 0 },
    visualStart: null,
    pendingPrefix: '',
  };

  it('h moves cursor left', () => {
    const result = vimHandleKey(normalState, 'h', ['hello']);
    expect(result.state.cursor.col).toBe(1);
  });

  it('l moves cursor right', () => {
    const result = vimHandleKey(normalState, 'l', ['hello']);
    expect(result.state.cursor.col).toBe(3);
  });

  it('h at col 0 does not move cursor negative', () => {
    const s: VimState = { ...normalState, cursor: { col: 0, row: 0 } };
    const result = vimHandleKey(s, 'h', ['hello']);
    expect(result.state.cursor.col).toBe(0);
  });

  it('l at end of line does not exceed line length', () => {
    const s: VimState = { ...normalState, cursor: { col: 5, row: 0 } }; // 'hello' has length 5
    const result = vimHandleKey(s, 'l', ['hello']);
    expect(result.state.cursor.col).toBe(5);
  });

  it('0 moves to start of line', () => {
    const result = vimHandleKey(normalState, '0', ['hello']);
    expect(result.state.cursor.col).toBe(0);
  });

  it('$ moves to end of line', () => {
    const result = vimHandleKey(normalState, '$', ['hello']);
    expect(result.state.cursor.col).toBe(5);
  });

  it('j moves cursor down', () => {
    const result = vimHandleKey(normalState, 'j', ['hello', 'world']);
    expect(result.state.cursor.row).toBe(1);
  });

  it('k moves cursor up', () => {
    const s: VimState = { ...normalState, cursor: { col: 2, row: 1 } };
    const result = vimHandleKey(s, 'k', ['hello', 'world']);
    expect(result.state.cursor.row).toBe(0);
  });

  it('j at last line does not exceed', () => {
    const s: VimState = { ...normalState, cursor: { col: 0, row: 1 } };
    const result = vimHandleKey(s, 'j', ['hello', 'world']);
    expect(result.state.cursor.row).toBe(1);
  });

  it('w moves to next word', () => {
    const s: VimState = { ...normalState, cursor: { col: 0, row: 0 } };
    const result = vimHandleKey(s, 'w', ['hello world foo']);
    expect(result.state.cursor.col).toBe(6); // start of 'world'
  });

  it('b moves to previous word', () => {
    const s: VimState = { ...normalState, cursor: { col: 6, row: 0 } };
    const result = vimHandleKey(s, 'b', ['hello world foo']);
    expect(result.state.cursor.col).toBe(0); // start of 'hello'
  });
});

describe('T-047: NORMAL mode — entering INSERT (AC #3)', () => {
  const normalState: VimState = {
    mode: 'NORMAL',
    cursor: { col: 2, row: 0 },
    visualStart: null,
    pendingPrefix: '',
  };

  it('i enters INSERT mode (before cursor)', () => {
    const result = vimHandleKey(normalState, 'i', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(2); // unchanged
  });

  it('a enters INSERT mode (after cursor)', () => {
    const result = vimHandleKey(normalState, 'a', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(3); // moved right
  });

  it('A enters INSERT mode at end of line', () => {
    const result = vimHandleKey(normalState, 'A', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(5); // end of 'hello'
  });

  it('I enters INSERT mode at start of line', () => {
    const result = vimHandleKey(normalState, 'I', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.state.cursor.col).toBe(0);
  });

  it('o produces newline + enters INSERT', () => {
    const result = vimHandleKey(normalState, 'o', ['hello']);
    expect(result.state.mode).toBe('INSERT');
    expect(result.action).toEqual({ type: 'newline' });
    expect(result.state.cursor.row).toBe(1);
  });
});

describe('T-047: NORMAL mode — delete operations (AC #3)', () => {
  const normalState: VimState = {
    mode: 'NORMAL',
    cursor: { col: 2, row: 0 },
    visualStart: null,
    pendingPrefix: '',
  };

  it('x deletes char under cursor (deleteForward)', () => {
    const result = vimHandleKey(normalState, 'x', ['hello']);
    expect(result.action).toEqual({ type: 'deleteForward' });
  });

  it('dd deletes the current line', () => {
    // First 'd' sets pendingPrefix.
    const r1 = vimHandleKey(normalState, 'd', ['hello']);
    expect(r1.state.pendingPrefix).toBe('d');
    // Second 'd' produces deleteLine.
    const r2 = vimHandleKey(r1.state, 'd', ['hello']);
    expect(r2.action).toEqual({ type: 'deleteLine' });
    expect(r2.state.pendingPrefix).toBe('');
  });

  it('d followed by non-d cancels pending (x is consumed, not processed)', () => {
    const r1 = vimHandleKey(normalState, 'd', ['hello']);
    const r2 = vimHandleKey(r1.state, 'x', ['hello']);
    expect(r2.state.pendingPrefix).toBe('');
    // The 'x' is consumed as the "unknown second char after d" — it does
    // NOT produce a deleteForward action. This matches vim's behavior:
    // 'dx' is not a valid command, so both chars are discarded.
    expect(r2.action.type).toBe('none');
  });
});

describe('T-047: VISUAL mode (AC #4)', () => {
  it('v enters VISUAL mode with visualStart at cursor', () => {
    const normalState: VimState = {
      mode: 'NORMAL',
      cursor: { col: 2, row: 0 },
      visualStart: null,
      pendingPrefix: '',
    };
    const result = vimHandleKey(normalState, 'v', ['hello']);
    expect(result.state.mode).toBe('VISUAL');
    expect(result.state.visualStart).toEqual({ col: 2, row: 0 });
  });

  it('h/l move cursor in VISUAL mode', () => {
    const visualState: VimState = {
      mode: 'VISUAL',
      cursor: { col: 3, row: 0 },
      visualStart: { col: 3, row: 0 },
      pendingPrefix: '',
    };
    const r1 = vimHandleKey(visualState, 'h', ['hello']);
    expect(r1.state.cursor.col).toBe(2);
    expect(r1.state.visualStart).toEqual({ col: 3, row: 0 }); // unchanged

    const r2 = vimHandleKey(visualState, 'l', ['hello']);
    expect(r2.state.cursor.col).toBe(4);
  });

  it('x in VISUAL deletes selection and returns to NORMAL', () => {
    const visualState: VimState = {
      mode: 'VISUAL',
      cursor: { col: 4, row: 0 },
      visualStart: { col: 2, row: 0 },
      pendingPrefix: '',
    };
    const result = vimHandleKey(visualState, 'x', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
    expect(result.state.visualStart).toBeNull();
    expect(result.action.type).toBe('deleteSelection');
  });

  it('d in VISUAL deletes selection (same as x)', () => {
    const visualState: VimState = {
      mode: 'VISUAL',
      cursor: { col: 4, row: 0 },
      visualStart: { col: 2, row: 0 },
      pendingPrefix: '',
    };
    const result = vimHandleKey(visualState, 'd', ['hello']);
    expect(result.action.type).toBe('deleteSelection');
  });

  it('Esc in VISUAL cancels selection and returns to NORMAL', () => {
    const visualState: VimState = {
      mode: 'VISUAL',
      cursor: { col: 4, row: 0 },
      visualStart: { col: 2, row: 0 },
      pendingPrefix: '',
    };
    const result = vimHandleKey(visualState, 'Esc', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
    expect(result.state.visualStart).toBeNull();
    expect(result.action.type).toBe('none');
  });
});

describe('T-047: Mode indicator (AC #5)', () => {
  it('vimModeLabel returns "-- INSERT --" for INSERT', () => {
    expect(vimModeLabel('INSERT')).toBe('-- INSERT --');
  });

  it('vimModeLabel returns "-- NORMAL --" for NORMAL', () => {
    expect(vimModeLabel('NORMAL')).toBe('-- NORMAL --');
  });

  it('vimModeLabel returns "-- VISUAL --" for VISUAL', () => {
    expect(vimModeLabel('VISUAL')).toBe('-- VISUAL --');
  });
});

describe('T-047: Mode transitions (AC #6)', () => {
  it('INSERT → Esc → NORMAL → i → INSERT', () => {
    let s = initialVimState();
    expect(s.mode).toBe('INSERT');

    s = vimHandleKey(s, 'Esc', ['hello']).state;
    expect(s.mode).toBe('NORMAL');

    s = vimHandleKey(s, 'i', ['hello']).state;
    expect(s.mode).toBe('INSERT');
  });

  it('NORMAL → v → VISUAL → Esc → NORMAL', () => {
    let s: VimState = {
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
      visualStart: null,
      pendingPrefix: '',
    };

    s = vimHandleKey(s, 'v', ['hello']).state;
    expect(s.mode).toBe('VISUAL');

    s = vimHandleKey(s, 'Esc', ['hello']).state;
    expect(s.mode).toBe('NORMAL');
  });

  it('INSERT → Esc → v → VISUAL → x → NORMAL (delete selection)', () => {
    let s = initialVimState();
    s = vimHandleKey(s, 'Esc', ['hello']).state;
    expect(s.mode).toBe('NORMAL');

    s = vimHandleKey(s, 'v', ['hello']).state;
    expect(s.mode).toBe('VISUAL');

    const result = vimHandleKey(s, 'x', ['hello']);
    expect(result.state.mode).toBe('NORMAL');
    expect(result.action.type).toBe('deleteSelection');
  });
});

describe('T-047: Edge cases', () => {
  it('unknown key in NORMAL mode produces no action', () => {
    const s: VimState = {
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
      visualStart: null,
      pendingPrefix: '',
    };
    const result = vimHandleKey(s, 'Z', ['hello']);
    expect(result.action.type).toBe('none');
  });

  it('Esc in NORMAL clears pendingPrefix', () => {
    const s: VimState = {
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
      visualStart: null,
      pendingPrefix: 'd',
    };
    const result = vimHandleKey(s, 'Esc', ['hello']);
    expect(result.state.pendingPrefix).toBe('');
  });

  it('handles empty text lines', () => {
    const s: VimState = {
      mode: 'NORMAL',
      cursor: { col: 0, row: 0 },
      visualStart: null,
      pendingPrefix: '',
    };
    const result = vimHandleKey(s, 'l', ['']);
    expect(result.state.cursor.col).toBe(0);
  });

  it('handles cursor row beyond textLines', () => {
    const s: VimState = {
      mode: 'NORMAL',
      cursor: { col: 0, row: 5 },
      visualStart: null,
      pendingPrefix: '',
    };
    const result = vimHandleKey(s, 'j', ['hello']);
    // Should not throw; cursor row clamped to textLines.length - 1 = 0.
    expect(result.state.cursor.row).toBe(0);
  });
});
