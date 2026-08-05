/**
 * components/DiffReviewDialog.tsx — Per-change diff review overlay.
 *
 * The #1 most-requested feature across agent CLIs. Shows a unified diff
 * of the proposed file edit BEFORE it's applied, with per-change
 * accept/reject buttons. Claude Code shows inline diffs in chat; Gemini
 * CLI shows a diff before confirming mutators. Goli previously applied
 * edits directly — the PermissionDialog approved *intent*, not *diffs*.
 *
 * Design:
 *   ┌─ Diff Review: edit_file ───────────────────────────────────┐
 *   │ File: src/foo.ts                                           │
 *   │                                                             │
 *   │  -const x = oldFunction();                                  │
 *   │  +const x = newFunction();                                  │
 *   │                                                             │
 *   │  (a)ccept  (r)eject  (A)ccept all  (R)eject all            │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The dialog is rendered when the agent emits an edit_file or write_file
 * tool call and the user has diff-review enabled (default: on).
 */

import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import { T } from '../theme/tokens.js';

/**
 *
 */
export interface DiffEntry {
  /** The file path. */
  filePath: string;
  /** The tool that produced the diff (edit_file / write_file). */
  tool: string;
  /** The old content (for edit_file) or empty (for write_file). */
  oldContent: string;
  /** The new content. */
  newContent: string;
  /** The diff lines (unified diff format, pre-computed). */
  diffLines: string[];
}

interface Props {
  entries: DiffEntry[];
  onAccept: (index: number) => void;
  onReject: (index: number) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/**
 * Compute a simple unified diff between old and new content.
 *
 * This is a line-level diff (not character-level). For most code edits,
 * line-level is sufficient and much faster than a proper LCS diff.
 * @param oldContent
 * @param newContent
 */
export function computeDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lines: string[] = [];

  // Find common prefix.
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix.
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Context lines (before).
  const contextStart = Math.max(0, prefixLen - 3);
  for (let i = contextStart; i < prefixLen; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  // Removed lines.
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    lines.push(`-${oldLines[i]}`);
  }

  // Added lines.
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    lines.push(`+${newLines[i]}`);
  }

  // Context lines (after).
  const suffixStart = oldLines.length - suffixLen;
  const contextEnd = Math.min(oldLines.length, suffixStart + 3);
  for (let i = suffixStart; i < contextEnd; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  return lines;
}

function DiffReviewDialogImpl({
  entries,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: Props): React.ReactElement {
  const [currentIndex, setCurrentIndex] = useState(0);

  // T-089 (refinement): ALL hooks must be called before any early return
  // to satisfy the Rules of Hooks. Previously `useInput` was called after
  // the `!entry` early return, which would crash React if entries was
  // empty (hook order would change between renders).
  //
  // P0-5 fix: The previous implementation lowercased `input` and then
  // compared `lower === 'A'` / `lower === 'R'` — both branches were
  // dead code, so "Accept All" (Shift+A) and "Reject All" (Shift+R)
  // were unreachable. We now check the raw `input` for the uppercase
  // variants. Using `key.shift` as an additional guard would also work,
  // but Ink doesn't reliably set `key.shift` for letter keys across all
  // terminals (some send the bare uppercase letter without the shift
  // flag), so we rely on case sensitivity instead.
  useInput((input, key) => {
    if (input === 'A') {
      // Shift+A = accept all
      onAcceptAll();
      return;
    }
    if (input === 'R') {
      // Shift+R = reject all
      onRejectAll();
      return;
    }
    const lower = input.toLowerCase();
    if (lower === 'a') {
      onAccept(currentIndex);
      if (currentIndex < entries.length - 1) setCurrentIndex(currentIndex + 1);
      return;
    }
    if (lower === 'r') {
      onReject(currentIndex);
      if (currentIndex < entries.length - 1) setCurrentIndex(currentIndex + 1);
      return;
    }
    if (key.escape) {
      onRejectAll();
      return;
    }
  }, { isActive: entries.length > 0 });  // P1-25 fix: gate so we don't conflict with PromptInput

  const entry = entries[currentIndex];
  if (!entry) {
    return (
      <Box borderStyle="double" borderColor={T.green} paddingX={1} flexDirection="column">
        <Text color={T.green}>All diffs reviewed.</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="double" borderColor={T.yellow} paddingX={1} flexDirection="column">
      <Box justifyContent="center">
        <Text color={T.yellow} bold>
          Diff Review ({currentIndex + 1}/{entries.length}): {entry.tool}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={T.gray}>File: </Text>
        <Text color={T.fg}>{entry.filePath}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {entry.diffLines.slice(0, 15).map((line, i) => {
          if (line.startsWith('+')) {
            return <Text key={i} color={T.green}>{line}</Text>;
          }
          if (line.startsWith('-')) {
            return <Text key={i} color={T.red}>{line}</Text>;
          }
          return <Text key={i} color={T.gray}>{line}</Text>;
        })}
        {entry.diffLines.length > 15 && (
          <Text color={T.gray}>... ({entry.diffLines.length - 15} more lines)</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={T.gray}>
          (<Text color={T.green}>a</Text>)ccept  (<Text color={T.red}>r</Text>)eject  (<Text color={T.green}>A</Text>)ccept all  (<Text color={T.red}>R</Text>)eject all
        </Text>
      </Box>
      <Box>
        <Text color={T.border}>Esc = reject all</Text>
      </Box>
    </Box>
  );
}

/**
 *
 */
export const DiffReviewDialog = React.memo(DiffReviewDialogImpl);
