/**
 * components/PolicyUpdateDialog.tsx — Accept/Ignore dialog for changed policies.
 *
 * Renders when `PolicyIntegrityManager.checkIntegrity()` returns MISMATCH.
 * The user chooses:
 *   - ACCEPT (a) — persist the new hash + load the changed policies.
 *   - IGNORE (i) — load defaults only, do NOT persist the hash.
 *   - ESC       — close without changing the stored hash (safe default).
 *
 * Mirrors gemini-cli's `PolicyUpdateDialog.tsx` pattern.
 *
 * @module PolicyUpdateDialog
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../theme/tokens.js';
import type { IntegrityResult } from '@goli/core';

interface PolicyUpdateDialogProps {
  /** The integrity result from checkIntegrity(). */
  result: IntegrityResult;
  /** The scope being checked (e.g. 'project'). */
  scope: string;
  /** The identifier being checked (e.g. project path). */
  identifier: string;
  /** Called when the user picks ACCEPT. */
  onAccept: () => void;
  /** Called when the user picks IGNORE. */
  onIgnore: () => void;
  /** Called when the user presses ESC. */
  onCancel: () => void;
}

/**
 * A 2-option (ACCEPT / IGNORE) dialog for changed policy files.
 * ESC cancels without changing the stored hash.
 */
export function PolicyUpdateDialog({
  result,
  scope,
  identifier,
  onAccept,
  onIgnore,
  onCancel,
}: PolicyUpdateDialogProps): React.ReactElement {
  const [selected, setSelected] = useState<'accept' | 'ignore'>('accept');

  useInput((input, key) => {
    // P1-25 fix: also accept Shift+A / Shift+I (uppercase) — was case-sensitive.
    const lower = input.toLowerCase();
    if (key.leftArrow || lower === 'a') {
      setSelected('accept');
      return;
    }
    if (key.rightArrow || lower === 'i') {
      setSelected('ignore');
      return;
    }
    if (key.return) {
      if (selected === 'accept') onAccept();
      else onIgnore();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
  }, { isActive: true });  // P1-25 fix: gate so we don't conflict with PromptInput

  return (
    <Box
      borderStyle="double"
      borderColor={T.yellow}
      paddingX={1}
      flexDirection="column"
      width={72}
    >
      <Box justifyContent="center">
        <Text color={T.yellow} bold>Policy Files Changed</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={T.gray}>Scope: </Text>
        <Text color={T.fg}>{scope}</Text>
      </Box>
      <Box>
        <Text color={T.gray}>Path:  </Text>
        <Text color={T.fg}>{identifier}</Text>
      </Box>
      <Box>
        <Text color={T.gray}>Files: </Text>
        <Text color={T.fg}>{result.fileCount}</Text>
      </Box>
      <Box>
        <Text color={T.gray}>Hash:  </Text>
        <Text color={T.fg}>{result.hash.slice(0, 16)}…</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={T.fg}>
          Policy files have changed since your last session. Choose how to proceed:
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={selected === 'accept' ? T.green : T.gray}>
          {selected === 'accept' ? '▶' : ' '} (a)ccept
        </Text>
        <Text color={T.gray}>  —  load the new policies and remember this hash</Text>
      </Box>
      <Box>
        <Text color={selected === 'ignore' ? T.red : T.gray}>
          {selected === 'ignore' ? '▶' : ' '} (i)gnore
        </Text>
        <Text color={T.gray}>  —  load defaults only, don't persist the hash</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={T.border}>← → navigate · Enter = select · Esc = cancel (safe default)</Text>
      </Box>
    </Box>
  );
}
