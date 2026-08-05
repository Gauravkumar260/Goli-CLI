/**
 * lib/vimMode.ts — Vim mode state machine for PromptInput.
 *
 * T-047 (loop run 5): closes a major UI gap vs gemini-cli, which has a
 * 1933-line InputPrompt.tsx with full vim mode via VimModeContext.
 *
 * This implementation provides a minimal but functional vim mode with
 * 3 modes: INSERT (default), NORMAL, VISUAL.
 *
 * ## Modes
 *
 * ### INSERT mode (default)
 *   - Normal typing inserts characters at cursor.
 *   - Esc → NORMAL mode.
 *   - Backspace deletes char before cursor.
 *   - Enter submits (preserved from existing PromptInput).
 *
 * ### NORMAL mode
 *   - h ← move cursor left
 *   - l → move cursor right
 *   - j ↓ move cursor down (multiline)
 *   - k ↑ move cursor up (multiline)
 *   - i → INSERT mode (before cursor)
 *   - a → INSERT mode (after cursor)
 *   - A → INSERT mode (end of line)
 *   - I → INSERT mode (start of line)
 *   - o → INSERT mode (new line below)
 *   - O → INSERT mode (new line above)
 *   - x → delete char under cursor
 *   - dd → delete current line
 *   - 0 → move to start of line
 *   - $ → move to end of line
 *   - w → move to next word
 *   - b → move to previous word
 *   - v → VISUAL mode
 *
 * ### VISUAL mode
 *   - h/j/k/l move selection.
 *   - x or d → delete selection, return to NORMAL.
 *   - Esc → NORMAL mode (clear selection).
 *
 * The state machine is pure: `vimHandleKey(state, key)` returns a new
 * state + optional action. PromptInput wires this into its useInput.
 */

/** Vim modes. */
export type VimMode = 'INSERT' | 'NORMAL' | 'VISUAL';

/** Cursor position in the text (0-based char index). */
export interface Cursor {
  /** Character index in the line. */
  col: number;
  /** Line index (0-based). */
  row: number;
}

/** Vim state — owned by PromptInput, passed to vimHandleKey. */
export interface VimState {
  mode: VimMode;
  cursor: Cursor;
  /** Visual mode selection start (null when not in VISUAL mode). */
  visualStart: Cursor | null;
  /** Pending command prefix (e.g. 'd' waiting for 'd' to form 'dd'). */
  pendingPrefix: string;
}

/** Initial vim state: INSERT mode, cursor at start. */
export function initialVimState(): VimState {
  return {
    mode: 'INSERT',
    cursor: { col: 0, row: 0 },
    visualStart: null,
    pendingPrefix: '',
  };
}

/** Action returned by vimHandleKey — tells PromptInput what to do. */
export type VimAction =
  | { type: 'insert'; text: string }
  | { type: 'deleteBackward' }
  | { type: 'deleteForward' }
  | { type: 'deleteLine' }
  | { type: 'deleteSelection'; start: Cursor; end: Cursor }
  | { type: 'newline' }
  | { type: 'submit' }
  | { type: 'none' };

/** Result of vimHandleKey: new state + optional action. */
export interface VimHandleResult {
  state: VimState;
  action: VimAction;
}

/**
 * Handle a key in vim mode. Returns the new state + an action for
 * PromptInput to execute (insert text, delete, submit, etc.).
 *
 * This is a PURE function — no side effects. PromptInput applies the
 * action to its own text state.
 *
 * @param state - Current vim state.
 * @param key - The key pressed (lowercase letter, or special like 'Esc', 'Enter', etc.).
 * @param textLines - The current text split into lines (for cursor clamping).
 * @returns New state + action.
 */
export function vimHandleKey(
  state: VimState,
  key: string,
  textLines: string[],
): VimHandleResult {
  const noAction: VimAction = { type: 'none' };

  // ─── Global keys (work in all modes) ──────────────────────────
  if (key === 'Esc' || key === 'Escape') {
    if (state.mode === 'INSERT') {
      // Switch to NORMAL; move cursor left by 1 (vim convention).
      return {
        state: { ...state, mode: 'NORMAL', pendingPrefix: '', visualStart: null,
          cursor: { ...state.cursor, col: Math.max(0, state.cursor.col - 1) } },
        action: noAction,
      };
    }
    if (state.mode === 'VISUAL') {
      // Cancel visual selection.
      return {
        state: { ...state, mode: 'NORMAL', visualStart: null, pendingPrefix: '' },
        action: noAction,
      };
    }
    // Already in NORMAL — clear pending prefix.
    return { state: { ...state, pendingPrefix: '' }, action: noAction };
  }

  // ─── INSERT mode ──────────────────────────────────────────────
  if (state.mode === 'INSERT') {
    if (key === 'Enter') {
      return { state, action: { type: 'submit' } };
    }
    if (key === 'Backspace') {
      return { state, action: { type: 'deleteBackward' } };
    }
    if (key === 'newline') {
      return { state, action: { type: 'newline' } };
    }
    // Printable char.
    if (key.length === 1) {
      return { state, action: { type: 'insert', text: key } };
    }
    return { state, action: noAction };
  }

  // ─── NORMAL mode ──────────────────────────────────────────────
  if (state.mode === 'NORMAL') {
    // Handle pending prefix (e.g. 'd' waiting for second 'd' = dd).
    if (state.pendingPrefix === 'd') {
      if (key === 'd') {
        return {
          state: { ...state, pendingPrefix: '' },
          action: { type: 'deleteLine' },
        };
      }
      // Unknown second char — cancel pending.
      return { state: { ...state, pendingPrefix: '' }, action: noAction };
    }

    const currentLine = textLines[state.cursor.row] ?? '';
    const newCursor: Cursor = { ...state.cursor };

    switch (key) {
      case 'h': // left
        newCursor.col = Math.max(0, state.cursor.col - 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'l': // right
        newCursor.col = Math.min(currentLine.length, state.cursor.col + 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'j': // down
        newCursor.row = Math.min(textLines.length - 1, state.cursor.row + 1);
        newCursor.col = Math.min((textLines[newCursor.row] ?? '').length, state.cursor.col);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'k': // up
        newCursor.row = Math.max(0, state.cursor.row - 1);
        newCursor.col = Math.min((textLines[newCursor.row] ?? '').length, state.cursor.col);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case '0': // start of line
        newCursor.col = 0;
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case '$': // end of line
        newCursor.col = currentLine.length;
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'w': // next word
        newCursor.col = nextWord(currentLine, state.cursor.col);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'b': // previous word
        newCursor.col = prevWord(currentLine, state.cursor.col);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'i': // insert before cursor
        return { state: { ...state, mode: 'INSERT' }, action: noAction };
      case 'a': // insert after cursor
        newCursor.col = Math.min(currentLine.length, state.cursor.col + 1);
        return { state: { ...state, mode: 'INSERT', cursor: newCursor }, action: noAction };
      case 'A': // insert at end of line
        newCursor.col = currentLine.length;
        return { state: { ...state, mode: 'INSERT', cursor: newCursor }, action: noAction };
      case 'I': // insert at start of line
        newCursor.col = 0;
        return { state: { ...state, mode: 'INSERT', cursor: newCursor }, action: noAction };
      case 'o': // new line below + insert
        return {
          state: { ...state, mode: 'INSERT', cursor: { row: state.cursor.row + 1, col: 0 } },
          action: { type: 'newline' },
        };
      case 'O': // new line above + insert (approximated as newline at current position)
        return {
          state: { ...state, mode: 'INSERT', cursor: { ...state.cursor, col: 0 } },
          action: { type: 'newline' },
        };
      case 'x': // delete char under cursor
        return { state, action: { type: 'deleteForward' } };
      case 'd': // pending — wait for second 'd'
        return { state: { ...state, pendingPrefix: 'd' }, action: noAction };
      case 'v': // visual mode
        return {
          state: { ...state, mode: 'VISUAL', visualStart: { ...state.cursor } },
          action: noAction,
        };
      case 'Enter':
        return { state, action: { type: 'submit' } };
      default:
        return { state, action: noAction };
    }
  }

  // ─── VISUAL mode ──────────────────────────────────────────────
  if (state.mode === 'VISUAL') {
    const currentLine = textLines[state.cursor.row] ?? '';
    const newCursor: Cursor = { ...state.cursor };

    switch (key) {
      case 'h':
        newCursor.col = Math.max(0, state.cursor.col - 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'l':
        newCursor.col = Math.min(currentLine.length, state.cursor.col + 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'j':
        newCursor.row = Math.min(textLines.length - 1, state.cursor.row + 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'k':
        newCursor.row = Math.max(0, state.cursor.row - 1);
        return { state: { ...state, cursor: newCursor }, action: noAction };
      case 'x':
      case 'd': {
        // Delete selection (from visualStart to cursor).
        const start = cursorMin(state.visualStart ?? state.cursor, state.cursor);
        const end = cursorMax(state.visualStart ?? state.cursor, state.cursor);
        return {
          state: { ...state, mode: 'NORMAL', visualStart: null },
          action: { type: 'deleteSelection', start, end },
        };
      }
      default:
        return { state, action: noAction };
    }
  }

  return { state, action: noAction };
}

/** Find the next word boundary (start of next word). */
function nextWord(line: string, fromCol: number): number {
  let i = fromCol;
  // Skip current word.
  while (i < line.length && !/\s/.test(line[i]!)) i++;
  // Skip whitespace.
  while (i < line.length && /\s/.test(line[i]!)) i++;
  return i;
}

/** Find the previous word boundary (start of previous word). */
function prevWord(line: string, fromCol: number): number {
  let i = fromCol - 1;
  // Skip whitespace backward.
  while (i > 0 && /\s/.test(line[i]!)) i--;
  // Skip word backward.
  while (i > 0 && !/\s/.test(line[i - 1]!)) i--;
  return Math.max(0, i);
}

/** Compare two cursors: returns the earlier one. */
function cursorMin(a: Cursor, b: Cursor): Cursor {
  if (a.row < b.row) return a;
  if (a.row > b.row) return b;
  return a.col <= b.col ? a : b;
}

/** Compare two cursors: returns the later one. */
function cursorMax(a: Cursor, b: Cursor): Cursor {
  if (a.row > b.row) return a;
  if (a.row < b.row) return b;
  return a.col >= b.col ? a : b;
}

/** Mode indicator label for the PromptInput footer. */
export function vimModeLabel(mode: VimMode): string {
  switch (mode) {
    case 'INSERT': return '-- INSERT --';
    case 'NORMAL': return '-- NORMAL --';
    case 'VISUAL': return '-- VISUAL --';
  }
}
