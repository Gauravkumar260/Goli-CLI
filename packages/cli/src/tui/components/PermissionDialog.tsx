/**
 * components/PermissionDialog.tsx — Modal approval overlay.
 *
 * Renders when the agent loop hits a permission gate (ActionGate
 * returns REQUIRES_REVIEW). The user responds with a single key:
 *
 *   (y)es once · yes (a)llow always · (n)o · (v)iew · (e)dit
 *   Ctrl+K = fast-approve (Antigravity pattern)
 *
 * Modeled on Crush's single-letter approval prompt and Hermes's
 * approval_widget overlay layer (see Reference Manual §3.6).
 *
 * Design:
 *   ┌─ Permission Request ─────────────────────────────────┐
 *   │                                                     │
 *   │  Tool:   write_file  (T1: read + write)             │
 *   │  Target: src/foo.ts                                 │
 *   │                                                     │
 *   │  (y)es once  yes (a)llow always  (n)o  (v)iew  (e)dit │
 *   └─────────────────────────────────────────────────────┘
 */
import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { T } from '../theme/tokens.js';
import { getTierColor, getTierDesc, type TierId } from '../theme/agents.js';
import { AppStateStore } from '../state/AppStateStore.js';
import type { PendingPermission } from '../state/types.js';

interface Props {
  request: PendingPermission;
  cols: number;
  /**
   * T-068: Called when the user presses `v` to view the proposed diff.
   * Only invoked when `request.diffEntry` is populated. The parent
   * (App.tsx) swaps the PermissionDialog for the DiffReviewDialog.
   */
  onViewDiff?: () => void;
}

/**
 * Truncate a long arg string for display. Shows the last 60 chars
 * with ellipsis prefix if truncated.
 */
function displayArg(arg: string, max = 60): string {
  if (arg.length <= max) return arg;
  return '…' + arg.slice(-(max - 1));
}

function PermissionDialogImpl({ request, cols, onViewDiff }: Props): React.ReactElement {
  const tierColor = getTierColor(request.tier as TierId);
  const tierDesc = getTierDesc(request.tier as TierId);

  useInput((_input, key) => {
    if (key.ctrl && key.shift && (_input === 'k' || _input === 'K')) {
      AppStateStore.resolveApproval({ approve: true, always: true });
      return;
    }
  });

  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === 'y') {
      AppStateStore.resolveApproval({ approve: true, always: false });
      return;
    }
    if (lower === 'a') {
      AppStateStore.resolveApproval({ approve: true, always: true });
      return;
    }
    if (lower === 'n') {
      AppStateStore.resolveApproval({ approve: false, always: false });
      return;
    }
    if (lower === 'v') {
      // T-068: If a diff payload is attached, open the DiffReviewDialog.
      // Otherwise, this is a no-op (read-only tools have nothing to view).
      if (request.diffEntry && onViewDiff) {
        onViewDiff();
      }
      return;
    }
    if (lower === 'e') {
      // Future: open in $EDITOR. For now, treat as view if diff available.
      if (request.diffEntry && onViewDiff) {
        onViewDiff();
      }
      return;
    }
    if (key.return) {
      // Enter = default approve
      AppStateStore.resolveApproval({ approve: true, always: false });
      return;
    }
    if (key.escape) {
      // Esc = deny
      AppStateStore.resolveApproval({ approve: false, always: false });
      return;
    }
  });

  const innerW = Math.min(cols - 4, 72);
  const sep = T.border;

  return (
    <Box
      borderStyle="double"
      borderColor={T.yellow}
      paddingX={1}
      width={cols}
      flexDirection="column"
    >
      <Box width={innerW} justifyContent="center">
        <Text color={T.yellow} bold>
          Permission Request
          {request.index !== undefined && request.total !== undefined && request.total > 1
            ? ` (${request.index} of ${request.total})`
            : ''}
        </Text>
      </Box>

      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>Tool: </Text>
        <Text color={T.fg}>{request.tool}</Text>
        <Text color={T.gray}>  (</Text>
        <Text color={tierColor}>{request.tier}</Text>
        <Text color={T.gray}>: {tierDesc})</Text>
      </Box>

      {request.arg && (
        <Box width={innerW}>
          <Text color={T.gray}>Target: </Text>
          <Text color={T.fg} wrap="truncate-end">{displayArg(request.arg)}</Text>
        </Box>
      )}

      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>
          (</Text><Text color={T.green}>y</Text><Text color={T.gray}>)es once  yes (</Text><Text color={T.green}>a</Text><Text color={T.gray}>)llow always  (</Text><Text color={T.red}>n</Text><Text color={T.gray}>)o  (</Text><Text color={T.blue}>v</Text><Text color={T.gray}>){request.diffEntry ? 'iew diff' : 'iew'}  (</Text><Text color={T.blue}>e</Text><Text color={T.gray}>)dit</Text>
      </Box>

      <Box width={innerW}>
        <Text color={T.border}>Ctrl+K = fast-approve · Enter = yes · Esc = no</Text>
      </Box>
    </Box>
  );
}

/**
 *
 */
export const PermissionDialog = React.memo(PermissionDialogImpl);
