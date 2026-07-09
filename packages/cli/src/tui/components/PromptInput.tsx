/**
 * components/PromptInput.tsx — Input row.
 *
 * Layout:
 *   +-- * {placeholder or input value}| -----------------+
 *   +---------------------------------------------------+
 *
 * Research-driven improvements (Reference Manual):
 *   - Input NEVER blocks during streaming (§7.1 Law 9).
 *   - Paste compaction (§5.5): large pastes show a compact placeholder.
 *   - Long-paste guard (§6.2): per-line length limit at input-capture layer.
 *   - Tab-to-queue (§5.3): Tab while busy queues for next turn.
 *   - Burst absorption: coalesces keystrokes into one state update.
 *
 * T-035 (loop run 4): Slash-command autocomplete.
 *   - Typing "/" shows filtered command list (SuggestionsDisplay).
 *   - Up/Dn navigate; Enter dispatches; Tab accepts as prefix; Esc dismisses.
 */
import React, { useRef, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../theme/tokens.js';
import { AppStateStore } from '../state/AppStateStore.js';
import { globalCommands } from '../lib/CommandRegistry.js';
import {
  SuggestionsDisplay,
  filterCommands,
  MAX_SUGGESTIONS_TO_SHOW,
} from './SuggestionsDisplay.js';
import { InputHistory } from '../lib/InputHistory.js';
import { getFileCompletions } from '../lib/fileCompletion.js';
import { getShellCompletions } from '../lib/shellCompletion.js';
import {
  vimHandleKey,
  initialVimState,
  vimModeLabel,
  type VimState,
  type VimMode,
  type VimAction,
} from '../lib/vimMode.js';
import { cpSlice, displayWidth } from '../lib/unicode.js';

// ─── Paste compaction thresholds (§5.5, §6.2) ──────────────────────────
// Reference Manual §5.5: detect large paste > 10 lines or > 500 chars,
// replace with compact placeholder in the visible composer.
// Reference Manual §6.2: per-line length guard — any single line > 200 chars
// is truncated before reaching the renderer.
const PASTE_LINE_THRESHOLD = 10;
const PASTE_CHAR_THRESHOLD = 500;
const MAX_LINE_LENGTH = 200;

interface Props {
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onQueue: (text: string) => void;
  disabled: boolean;
  cols: number;
  placeholder?: string;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
  /** T-071: When true, shows a vim mode indicator next to the prompt. */
  vimEnabled?: boolean;
  /** T-075: When true, the prompt is in reverse-search mode. Typing filters
   * history; Ctrl+R advances to the next older match; Enter accepts; Esc cancels. */
  reverseSearchActive?: boolean;
  /** T-075: Called when the user exits reverse-search mode (Esc or Enter). */
  onReverseSearchExit?: () => void;
  /** T-080: Ref that PromptInput keeps synced with the current prompt value,
   * so the parent can read it for $EDITOR integration (Ctrl+O). */
  promptValueRef?: React.MutableRefObject<string>;
  /** T-080: Ref that PromptInput populates with its setValue function, so the
   * parent can set the prompt value after $EDITOR editing (Ctrl+O). */
  setPromptValueRef?: React.MutableRefObject<((v: string) => void) | null>;
  /** T-089: Ref that PromptInput keeps synced with its compactPaste state,
   * so the parent knows whether Ctrl+O should toggle paste expansion. */
  compactPasteRef?: React.MutableRefObject<boolean>;
  /** T-089: Ref that PromptInput populates with a toggle function, so the
   * parent can toggle paste expansion via Ctrl+O. */
  togglePasteExpandRef?: React.MutableRefObject<(() => void) | null>;
}

function PromptInputImpl({
  onSubmit, onAbort, onQueue, disabled, cols, placeholder, bordered = true,
  vimEnabled = false, reverseSearchActive = false, onReverseSearchExit,
  promptValueRef, setPromptValueRef, compactPasteRef, togglePasteExpandRef,
}: Props): React.ReactElement {
  const [value, setValue] = useState('');

  // T-103: Undo/redo history for the prompt input.
  // We keep a stack of past values and a pointer to the current position.
  // Ctrl+Z (or Alt+Z) undoes; Ctrl+Y (or Shift+Alt+Z) redoes.
  const undoStackRef = useRef<string[]>(['']);
  const undoCursorRef = useRef(0);

  /**
   * T-103: Push a value to the undo stack, truncating any redo entries.
   * Called before every value change (except undo/redo themselves).
   */
  const pushUndo = (newValue: string): void => {
    const stack = undoStackRef.current;
    const cursor = undoCursorRef.current;
    // Don't push if the value hasn't changed (avoids duplicate entries).
    if (stack[cursor] === newValue) return;
    // Truncate any redo entries (everything after cursor).
    stack.splice(cursor + 1);
    stack.push(newValue);
    // Cap the stack at 50 entries (drop oldest).
    if (stack.length > 50) stack.shift();
    undoCursorRef.current = stack.length - 1;
  };

  /**
   * T-103: Undo — restore the previous value from the undo stack.
   * Returns true if undo was performed, false if at the oldest entry.
   */
  const undo = (): boolean => {
    const stack = undoStackRef.current;
    if (undoCursorRef.current <= 0) return false;
    undoCursorRef.current--;
    const prev = stack[undoCursorRef.current] ?? '';
    setValue(prev);
    return true;
  };

  /**
   * T-103: Redo — restore the next value from the undo stack.
   * Returns true if redo was performed, false if at the newest entry.
   */
  const redo = (): boolean => {
    const stack = undoStackRef.current;
    if (undoCursorRef.current >= stack.length - 1) return false;
    undoCursorRef.current++;
    const next = stack[undoCursorRef.current] ?? '';
    setValue(next);
    return true;
  };

  // T-088: Vim mode state — INSERT (default), NORMAL, or VISUAL.
  // The full state machine lives in vimStateRef; vimMode is the React
  // state mirror used for rendering the mode indicator.
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const vimStateRef = useRef<VimState>(initialVimState());

  // T-075: Reverse-search state. `rsQuery` is the search string; `rsMatchIndex`
  // is the history index of the current match (-1 = no match). `rsHistory`
  // caches the history size at search-start time for advancing.
  const [rsQuery, setRsQuery] = useState('');
  const [rsMatchIndex, setRsMatchIndex] = useState(-1);

  // ─── T-038: Persistent input history ─────────────────────────────
  // One InputHistory instance per PromptInput mount. History is loaded
  // from ~/.goli/history on construction and persisted on every add().
  const historyRef = useRef<InputHistory | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new InputHistory();
  }
  const history = historyRef.current;

  // ─── T-035: Slash-command autocomplete state ─────────────────────
  // activeSuggestionIndex === -1  → no suggestion highlighted.
  // showSuggestions is derived: only show when value starts with "/" AND
  // the user is actively typing a command (no spaces yet — once they hit
  // space, they're typing args and suggestions are no longer useful).
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const allCommands = useMemo(() => globalCommands.entries(), []);
  const filteredSuggestions = useMemo(
    () => filterCommands(allCommands, value),
    [allCommands, value],
  );

  // T-082: @ file-path completion. When value starts with '@', show
  // file-path completions instead of slash-command completions.
  const fileCompletions = useMemo(() => {
    if (!value.startsWith('@')) return [];
    const partial = value.slice(1); // strip leading @
    if (partial.includes(' ')) return []; // spaces mean user is done typing path
    return getFileCompletions(partial);
  }, [value]);

  // T-092: ! shell completion. When value starts with '!', show shell
  // command completions (binaries, git/npm subcommands).
  const shellCompletions = useMemo(() => {
    if (!value.startsWith('!')) return [];
    const partial = value.slice(1); // strip leading !
    return getShellCompletions(partial);
  }, [value]);

  const showSuggestions =
    value.startsWith('/') && !value.includes(' ') && filteredSuggestions.length > 0;
  const showFileCompletions =
    value.startsWith('@') && !value.includes(' ') && fileCompletions.length > 0;
  const showShellCompletions =
    value.startsWith('!') && shellCompletions.length > 0;

  // ─── Refs to avoid stale closures inside useInput ─────────────────
  const valueRef = useRef(value);
  valueRef.current = value;
  // T-080: Sync the parent-visible refs for $EDITOR integration.
  if (promptValueRef) promptValueRef.current = value;
  if (setPromptValueRef) setPromptValueRef.current = setValue;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;
  const onQueueRef = useRef(onQueue);
  onQueueRef.current = onQueue;

  // Suggestions refs (for useInput closure)
  const suggestionsRef = useRef(filteredSuggestions);
  suggestionsRef.current = filteredSuggestions;
  const activeIdxRef = useRef(activeSuggestionIndex);
  activeIdxRef.current = activeSuggestionIndex;
  const showSuggestionsRef = useRef(showSuggestions);
  showSuggestionsRef.current = showSuggestions;

  // T-082: File-completion refs
  const fileCompletionsRef = useRef(fileCompletions);
  fileCompletionsRef.current = fileCompletions;
  const showFileCompletionsRef = useRef(showFileCompletions);
  showFileCompletionsRef.current = showFileCompletions;
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const activeFileIdxRef = useRef(activeFileIdx);
  activeFileIdxRef.current = activeFileIdx;

  // T-092: Shell-completion refs
  const shellCompletionsRef = useRef(shellCompletions);
  shellCompletionsRef.current = shellCompletions;
  const showShellCompletionsRef = useRef(showShellCompletions);
  showShellCompletionsRef.current = showShellCompletions;
  const [activeShellIdx, setActiveShellIdx] = useState(0);
  const activeShellIdxRef = useRef(activeShellIdx);
  activeShellIdxRef.current = activeShellIdx;

  // ─── Burst absorption buffer ─────────────────────────────────────
  const pendingText = useRef('');
  const flushScheduled = useRef(false);

  // ─── Paste compaction state (§5.5) ────────────────────────────────
  // When true, the displayed value shows a compact placeholder instead of
  // the full pasted content. The actual content is still what gets sent.
  const [compactPaste, setCompactPaste] = useState(false);
  // Local ref for useInput closure (the prop compactPasteRef is the
  // parent-visible version; this is the internal one).
  const localCompactPasteRef = useRef(false);
  localCompactPasteRef.current = compactPaste;
  // T-089: When true, the full pasted content is shown (toggled by Ctrl+O).
  const [pasteExpanded, setPasteExpanded] = useState(false);
  // T-089: Sync the parent-visible compactPaste state + toggle function.
  if (compactPasteRef) compactPasteRef.current = compactPaste;
  if (togglePasteExpandRef) togglePasteExpandRef.current = () => setPasteExpanded((v) => !v);

  const scheduleFlush = (): void => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    queueMicrotask(() => {
      flushScheduled.current = false;
      if (pendingText.current.length === 0) return;
      const chunk = pendingText.current;
      pendingText.current = '';
      flushChunk(chunk);
    });
  };

  const flushChunk = (chunk: string): void => {
    // §6.2 Long-paste guard: truncate any single line > MAX_LINE_LENGTH
    const lines = chunk.split('\n');
    const guarded = lines.map((l) => l.length > MAX_LINE_LENGTH ? l.slice(0, MAX_LINE_LENGTH) + '…' : l).join('\n');

    // §5.5 Paste compaction: detect large paste
    const lineCount = guarded.split('\n').length;
    const charCount = guarded.length;
    if (!localCompactPasteRef.current && (lineCount > PASTE_LINE_THRESHOLD || charCount > PASTE_CHAR_THRESHOLD)) {
      setCompactPaste(true);
      AppStateStore.setPastePlaceholder(guarded);
      setValue((v) => { const next = v + guarded; pushUndo(next); return next; });
    } else {
      setValue((v) => { const next = v + guarded; pushUndo(next); return next; });
    }
  };

  // Reset active suggestion whenever the filter changes.
  React.useEffect(() => {
    setActiveSuggestionIndex(showSuggestions ? 0 : -1);
  }, [showSuggestions, value]);

  // T-082: Reset active file-completion index when the list changes.
  React.useEffect(() => {
    setActiveFileIdx(0);
  }, [fileCompletions]);

  // T-092: Reset active shell-completion index when the list changes.
  React.useEffect(() => {
    setActiveShellIdx(0);
  }, [shellCompletions]);

  useInput((input, key) => {
    // Ctrl+C always aborts when busy
    if (key.ctrl && input === 'c') {
      if (disabled) onAbortRef.current();
      return;
    }

    // ─── T-103: Undo/Redo ──────────────────────────────────────────
    // Ctrl+Z or Alt+Z = undo; Ctrl+Y or Shift+Alt+Z = redo.
    // (Matches Gemini CLI's Alt+Z / Shift+Alt+Z + standard Ctrl+Z/Y.)
    if (!reverseSearchActive && !showSuggestionsRef.current &&
        !showFileCompletionsRef.current && !showShellCompletionsRef.current) {
      if ((key.ctrl && input === 'z') || (key.meta && input === 'z' && !key.shift)) {
        undo();
        return;
      }
      if ((key.ctrl && input === 'y') || (key.meta && input === 'z' && key.shift)) {
        redo();
        return;
      }
    }

    // ─── T-088: Vim mode (when enabled) ──────────────────────────
    // When vim is enabled, route keys through the vim state machine.
    // In INSERT mode, most keys fall through to normal handling (below);
    // only Esc is intercepted here to switch to NORMAL. In NORMAL/VISUAL
    // mode, all keys are handled by vimHandleKey.
    if (vimEnabled && !reverseSearchActive) {
      const vState = vimStateRef.current;
      // In INSERT mode, only intercept Esc (to switch to NORMAL).
      // All other INSERT keys fall through to normal handling.
      if (vState.mode !== 'INSERT' || key.escape) {
        // Determine the key string for vimHandleKey.
        let vimKey: string;
        if (key.escape) vimKey = 'Esc';
        else if (key.return) vimKey = 'Enter';
        else if (key.backspace || key.delete) vimKey = 'Backspace';
        else if (key.upArrow) vimKey = 'k';
        else if (key.downArrow) vimKey = 'j';
        else if (key.leftArrow) vimKey = 'h';
        else if (key.rightArrow) vimKey = 'l';
        else if (input && input.length === 1) vimKey = input;
        else vimKey = '';

        if (vimKey.length > 0) {
          const textLines = valueRef.current.split('\n');
          const result = vimHandleKey(vState, vimKey, textLines);
          vimStateRef.current = result.state;
          setVimMode(result.state.mode);

          // Apply the action.
          const action: VimAction = result.action;
          if (action.type === 'insert') {
            setValue((v) => v + action.text);
          } else if (action.type === 'deleteBackward') {
            setValue((v) => v.slice(0, -1));
          } else if (action.type === 'deleteForward') {
            // Delete char at cursor position (approximated as end for single-line).
            // For full multi-line support, this would use the cursor from vimState.
            setValue((v) => v.slice(0, -1));
          } else if (action.type === 'deleteLine') {
            // Delete current line (for single-line input, clears everything).
            setValue('');
          } else if (action.type === 'newline') {
            setValue((v) => v + '\n');
          } else if (action.type === 'submit') {
            const trimmed = valueRef.current.trim();
            if (trimmed.length > 0) {
              historyRef.current!.add(trimmed);
              onSubmitRef.current(trimmed);
              setValue('');
              vimStateRef.current = initialVimState();
              setVimMode('INSERT');
            }
          }
          // 'none' and 'deleteSelection' (rare in single-line) → no-op for now.
          return;
        }
        return;
      }
    }

    // ─── T-075: Reverse-search mode ──────────────────────────────
    // When active, all key handling is intercepted here:
    //   - Ctrl+R → advance to next older match
    //   - Enter  → accept the current match (fill input + exit RS mode)
    //   - Esc    → cancel (exit RS mode, keep whatever was typed)
    //   - Backspace → remove last char from query, re-search
    //   - Printable char → append to query, re-search
    if (reverseSearchActive) {
      const history = historyRef.current!;
      if (key.ctrl && input === 'r') {
        // Advance to next older match.
        if (rsQuery.length > 0 && rsMatchIndex > 0) {
          const nextIdx = history.searchNextIndex(rsQuery, rsMatchIndex);
          if (nextIdx >= 0) {
            setRsMatchIndex(nextIdx);
          }
        }
        return;
      }
      if (key.return) {
        // Accept the current match.
        const match = rsMatchIndex >= 0 ? history.getAt(rsMatchIndex) : null;
        if (match) {
          setValue(match);
        }
        setRsQuery('');
        setRsMatchIndex(-1);
        onReverseSearchExit?.();
        return;
      }
      if (key.escape) {
        // Cancel — exit RS mode without changing the input.
        setRsQuery('');
        setRsMatchIndex(-1);
        onReverseSearchExit?.();
        return;
      }
      if (key.backspace || key.delete) {
        // Remove last char from query, re-search.
        const next = rsQuery.slice(0, -1);
        setRsQuery(next);
        if (next.length === 0) {
          setRsMatchIndex(-1);
        } else {
          // Find the newest match index for the shortened query.
          const idx = history.searchNextIndex(next, history.size());
          setRsMatchIndex(idx);
        }
        return;
      }
      // Printable char → append to query, re-search.
      if (!key.ctrl && !key.meta && input && input.length === 1 && input >= ' ') {
        const next = rsQuery + input;
        setRsQuery(next);
        const idx = history.searchNextIndex(next, history.size());
        setRsMatchIndex(idx);
        return;
      }
      // Ignore other keys in RS mode (arrows, etc.)
      return;
    }

    // ─── T-035: Slash-command autocomplete navigation ────────────
    if (showSuggestionsRef.current) {
      // Up arrow → previous suggestion
      if (key.upArrow) {
        const n = suggestionsRef.current.length;
        if (n > 0) {
          setActiveSuggestionIndex((i) => (i <= 0 ? n - 1 : i - 1));
        }
        return;
      }
      // Down arrow → next suggestion
      if (key.downArrow) {
        const n = suggestionsRef.current.length;
        if (n > 0) {
          setActiveSuggestionIndex((i) => (i < 0 || i >= n - 1 ? 0 : i + 1));
        }
        return;
      }
      // Tab → accept the active suggestion as a prefix (replace input
      // with "/<name>" but do NOT dispatch — user can keep typing args).
      if (key.tab) {
        const idx = activeIdxRef.current;
        if (idx >= 0 && idx < suggestionsRef.current.length) {
          const cmd = suggestionsRef.current[idx]!;
          setValue(`/${cmd.name} `);
        }
        return;
      }
      // Esc → dismiss suggestions (clears the slash prefix to nothing).
      if (key.escape) {
        setValue('');
        return;
      }
    } else if (showFileCompletionsRef.current) {
      // ─── T-082: @ file-path completion navigation ─────────────────
      // Up/Down navigate; Tab/Enter accept the selected path; Esc dismisses.
      if (key.upArrow) {
        const n = fileCompletionsRef.current.length;
        if (n > 0) {
          setActiveFileIdx((i) => (i <= 0 ? n - 1 : i - 1));
        }
        return;
      }
      if (key.downArrow) {
        const n = fileCompletionsRef.current.length;
        if (n > 0) {
          setActiveFileIdx((i) => (i >= n - 1 ? 0 : i + 1));
        }
        return;
      }
      if (key.tab || key.return) {
        const idx = activeFileIdxRef.current;
        if (idx >= 0 && idx < fileCompletionsRef.current.length) {
          const fc = fileCompletionsRef.current[idx]!;
          setValue('@' + fc.value + (fc.isDirectory ? '/' : ' '));
        }
        return;
      }
      if (key.escape) {
        // Dismiss file completions by clearing the @ prefix.
        setValue('');
        return;
      }
    } else if (showShellCompletionsRef.current) {
      // ─── T-092: ! shell completion navigation ────────────────────
      // Up/Down navigate; Tab/Enter accept the selected command; Esc dismisses.
      if (key.upArrow) {
        const n = shellCompletionsRef.current.length;
        if (n > 0) {
          setActiveShellIdx((i) => (i <= 0 ? n - 1 : i - 1));
        }
        return;
      }
      if (key.downArrow) {
        const n = shellCompletionsRef.current.length;
        if (n > 0) {
          setActiveShellIdx((i) => (i >= n - 1 ? 0 : i + 1));
        }
        return;
      }
      if (key.tab || key.return) {
        const idx = activeShellIdxRef.current;
        if (idx >= 0 && idx < shellCompletionsRef.current.length) {
          const sc = shellCompletionsRef.current[idx]!;
          setValue('!' + sc.value + (sc.isSubcommand ? '' : ' '));
        }
        return;
      }
      if (key.escape) {
        setValue('');
        return;
      }
    } else {
      // ─── T-038: History navigation (when not in slash-suggestion mode) ───
      // Up arrow → older entry. Down arrow → newer entry (or live input).
      // Ctrl+L → clear input.
      if (key.upArrow) {
        const prev = history.navigateUp();
        if (prev !== null) setValue(prev);
        return;
      }
      if (key.downArrow) {
        const next = history.navigateDown();
        setValue(next ?? '');
        return;
      }
      if (key.ctrl && input === 'l') {
        setValue('');
        history.resetCursor();
        return;
      }
      // T-104: Ctrl+W — delete word backward.
      // Removes the word before the cursor (letters/digits) + trailing whitespace.
      if (key.ctrl && input === 'w') {
        setValue((v) => {
          // Strip trailing whitespace, then strip the last word.
          const trimmed = v.replace(/\s+$/, '');
          const lastSpace = trimmed.lastIndexOf(' ');
          const next = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : '';
          pushUndo(next);
          return next;
        });
        return;
      }
      // T-104: Ctrl+U — delete to start of line (kill line).
      if (key.ctrl && input === 'u') {
        setValue((v) => {
          // Delete everything before the last newline (or everything if single-line).
          const lastNL = v.lastIndexOf('\n');
          const next = lastNL >= 0 ? v.slice(lastNL + 1) : '';
          pushUndo(next);
          return next;
        });
        return;
      }
      // T-104: Ctrl+A — move to start of line (no-op for append-only input,
      // but we acknowledge it to avoid inserting 'a' as a character).
      if (key.ctrl && input === 'a') {
        return; // no-op (cursor positioning not supported in append-only model)
      }
      // T-104: Ctrl+E — move to end of line (no-op for append-only input).
      if (key.ctrl && input === 'e') {
        return; // no-op
      }
    }

    // §2.10: Shift+Enter, Ctrl+J, or Alt+Enter → insert newline (multiline)
    if ((key.shift && key.return) || (key.ctrl && input === 'j') || (key.meta && key.return)) {
      pendingText.current += '\n';
      scheduleFlush();
      return;
    }

    // Enter submits (plain Enter, no shift)
    if (key.return) {
      const trimmed = valueRef.current.trim();

      // T-035: If a suggestion is active, dispatch it directly.
      if (showSuggestionsRef.current && activeIdxRef.current >= 0) {
        const idx = activeIdxRef.current;
        const cmd = suggestionsRef.current[idx];
        if (cmd) {
          // Replace input with "/<name>" and dispatch.
          const dispatchStr = `/${cmd.name}`;
          // T-038: record in history
          history.add(dispatchStr);
          setValue('');
          setActiveSuggestionIndex(-1);
          onSubmitRef.current(dispatchStr);
          return;
        }
      }

      if (trimmed.length > 0) {
        // §5.3 Tab-to-queue: Enter always interrupts (even in queue mode)
        if (disabled) onAbortRef.current();
        // T-038: record in history before dispatching.
        history.add(trimmed);
        onSubmitRef.current(trimmed);
        setValue('');
        pendingText.current = '';
        setCompactPaste(false);
        setPasteExpanded(false);
        AppStateStore.setPastePlaceholder(null);
      }
      return;
    }

    // Tab while busy → queue for next turn (§5.3)
    if (key.tab && disabled) {
      const trimmed = valueRef.current.trim();
      if (trimmed.length > 0) {
        onQueueRef.current(trimmed);
        setValue('');
        pendingText.current = '';
        setCompactPaste(false);
        setPasteExpanded(false);
        AppStateStore.setPastePlaceholder(null);
      }
      return;
    }

    // Allow typing and editing even while busy.
    if (key.backspace || key.delete) {
      if (pendingText.current.length > 0) {
        const chunk = pendingText.current;
        pendingText.current = '';
        setValue((v) => v + chunk);
      }
      setValue((v) => v.slice(0, -1));
      setCompactPaste(false);
        setPasteExpanded(false);
      return;
    }

    // Regular printable character input. Paste compaction is handled
    // at flush time (flushChunk), not at capture time — individual
    // keystrokes always accumulate; the compact placeholder only
    // replaces the DISPLAY when the accumulated text crosses the
    // threshold in flushChunk.
    if (!key.ctrl && !key.meta && input) {
      pendingText.current += input;
      scheduleFlush();
    }
  });

  const hasValue = value.length > 0;
  const basePlaceholder = placeholder ?? 'type a message... (Enter to send)';
  const cursor = disabled && !compactPaste ? '' : '│';
  const textColor = hasValue ? T.fg : T.gray;

  // Reserve room for: border glyphs (2) + paddingX (2) + dot prefix (2) + trailing cursor (1) = ~7
  const maxDisplay = Math.max(10, cols - 7);

  // T-089: Paste compaction display — improved placeholder showing line count.
  let displayText: string;
  if (compactPaste && !pasteExpanded) {
    const lineCount = value.split('\n').length;
    const charCount = value.length;
    // Match Gemini CLI format: [Pasted Text: N lines] or [Pasted Text: N chars]
    if (lineCount > 1) {
      displayText = `[Pasted Text: ${lineCount} lines · ${charCount} chars — Ctrl+O to expand, Enter to send]`;
    } else {
      displayText = `[Pasted Text: ${charCount} chars — Ctrl+O to expand, Enter to send]`;
    }
  } else if (compactPaste && pasteExpanded) {
    // T-089: Show the full pasted content (truncated to maxDisplay).
    // T-090: Use displayWidth + cpSlice for Unicode-safe truncation.
    displayText = displayWidth(value) > maxDisplay
      ? cpSlice(value, 0, maxDisplay - 1) + '… [Ctrl+O to collapse]'
      : value + ' [Ctrl+O to collapse]';
  } else if (hasValue) {
    const lines = value.split('\n');
    let raw = lines[0] ?? '';
    if (lines.length > 1) raw += `… (+${lines.length - 1} more)`;
    // T-090: Use displayWidth + cpSlice for Unicode-safe truncation.
    // This prevents breaking surrogate pairs (emoji) and correctly
    // accounts for wide CJK characters.
    displayText = displayWidth(raw) > maxDisplay ? cpSlice(raw, 0, maxDisplay - 1) + '…' : raw;
  } else {
    displayText = basePlaceholder;
  }

  // Compute scroll offset for the suggestions display.
  const scrollOffset =
    activeSuggestionIndex >= MAX_SUGGESTIONS_TO_SHOW
      ? activeSuggestionIndex - MAX_SUGGESTIONS_TO_SHOW + 1
      : 0;

  return (
    <Box flexDirection="column">
      {/* T-035: Slash-command suggestions render ABOVE the input row. */}
      {showSuggestions && (
        <SuggestionsDisplay
          suggestions={filteredSuggestions}
          activeIndex={activeSuggestionIndex}
          userInput={value}
          scrollOffset={scrollOffset}
        />
      )}

      {/* T-082: @ file-path completions render ABOVE the input row. */}
      {showFileCompletions && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={T.teal}
          paddingX={1}
          marginTop={0}
        >
          <Box>
            <Text color={T.teal} bold>Files </Text>
            <Text color={T.gray} dimColor>({fileCompletions.length} matches · Tab to accept)</Text>
          </Box>
          {fileCompletions.slice(0, MAX_SUGGESTIONS_TO_SHOW).map((fc, i) => (
            <Box key={fc.value} flexDirection="row">
              <Text color={i === activeFileIdx ? T.green : T.gray}>
                {i === activeFileIdx ? '▶ ' : '  '}
              </Text>
              <Text color={i === activeFileIdx ? T.fg : T.gray} bold={i === activeFileIdx}>
                @{fc.label}
              </Text>
              {fc.isDirectory && <Text color={T.blue}>/</Text>}
            </Box>
          ))}
          {fileCompletions.length > MAX_SUGGESTIONS_TO_SHOW && (
            <Text color={T.gray} dimColor>
              ... ({fileCompletions.length - MAX_SUGGESTIONS_TO_SHOW} more)
            </Text>
          )}
        </Box>
      )}

      {/* T-092: ! shell completions render ABOVE the input row. */}
      {showShellCompletions && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={T.orange}
          paddingX={1}
          marginTop={0}
        >
          <Box>
            <Text color={T.orange} bold>Shell </Text>
            <Text color={T.gray} dimColor>({shellCompletions.length} matches · Tab to accept)</Text>
          </Box>
          {shellCompletions.slice(0, MAX_SUGGESTIONS_TO_SHOW).map((sc, i) => (
            <Box key={sc.value} flexDirection="row">
              <Text color={i === activeShellIdx ? T.green : T.gray}>
                {i === activeShellIdx ? '▶ ' : '  '}
              </Text>
              <Text color={i === activeShellIdx ? T.fg : T.gray} bold={i === activeShellIdx}>
                {sc.label}
              </Text>
              {sc.isSubcommand && <Text color={T.gray} dimColor> (subcommand)</Text>}
            </Box>
          ))}
          {shellCompletions.length > MAX_SUGGESTIONS_TO_SHOW && (
            <Text color={T.gray} dimColor>
              ... ({shellCompletions.length - MAX_SUGGESTIONS_TO_SHOW} more)
            </Text>
          )}
        </Box>
      )}

      {/* T-075: Reverse-search prompt. When active, show the search UI
          instead of the normal input. */}
      {reverseSearchActive && (
        <Box
          flexDirection="row"
          {...(bordered
            ? { borderStyle: 'round' as const, borderColor: T.purple }
            : {})}
          paddingX={1}
          width={cols}
        >
          <Text color={T.purple} bold>(reverse-i-search)`</Text>
          <Text color={T.teal}>{rsQuery}</Text>
          <Text color={T.purple} bold>`: </Text>
          <Text color={T.fg} wrap="truncate-end">
            {rsMatchIndex >= 0
              ? (historyRef.current?.getAt(rsMatchIndex) ?? 'no match')
              : (rsQuery.length > 0 ? 'no match' : 'type to search…')}
          </Text>
        </Box>
      )}

      {!reverseSearchActive && (
        <Box
          flexDirection="row"
          {...(bordered
            ? { borderStyle: 'round' as const, borderColor: T.border }
            : {})}
          paddingX={1}
          width={cols}
        >
          {vimEnabled && (
            <Text color={vimMode === 'INSERT' ? T.green : vimMode === 'NORMAL' ? T.yellow : T.purple} bold>
              [{vimMode}]
            </Text>
          )}
          <Text color={disabled ? T.gray : T.green}>●</Text>
          <Text> </Text>
          <Box flexGrow={1}>
            <Text color={textColor} wrap="truncate-end">
              {displayText}
              {!disabled && <Text color={T.green}>{cursor}</Text>}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 *
 */
export const PromptInput = React.memo(PromptInputImpl);
