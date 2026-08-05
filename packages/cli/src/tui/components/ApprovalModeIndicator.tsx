/**
 * components/ApprovalModeIndicator.tsx — Permission mode indicator (T-059).
 *
 * Reference: gemini-cli's `ApprovalModeIndicator.tsx` shows the current
 * approval mode (default / plan / YOLO / auto-accept-edits) with a keybind
 * hint to cycle modes. We implement a focused version for Goli-CLI's
 * permission modes (default / plan / safe / god).
 *
 * Modes (mapped from the canonical AppMode in App.tsx via APPMODE_TO_INDICATOR):
 *   - default  → "BUILD"  (green)   — full permissions per tier      (AppMode='build')
 *   - plan     → "PLAN"   (yellow)  — read-only, no edits             (AppMode='plan')
 *   - safe     → "SAFE"   (blue)    — read-only, no writes, no exec   (AppMode='read-only')
 *   - god      → "GOD"    (red)     — maximum autonomy, all gates off (AppMode='god')
 *
 * "SAFE" is an alias for the read-only AppMode — same tool filtering,
 * same system prompt, same tier (T0). The label difference is purely
 * cosmetic so users have a familiar "safe mode" affordance.
 *
 * The indicator shows the mode label + a keybind hint to cycle:
 *   "BUILD (Shift+Tab to cycle)"
 *
 * @module tui/components/ApprovalModeIndicator
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';

/** The permission mode (mirrors AppStateSnapshot.permissionMode). */
export type PermissionMode = 'default' | 'plan' | 'safe' | 'god';

interface Props {
  /** Current permission mode. */
  mode: PermissionMode;
  /** Whether godmode is active (overrides mode display). */
  godMode?: boolean;
  /** Terminal width. On narrow terminals, the keybind hint is hidden. */
  cols: number;
  /** Show the keybind hint. Default: true on wide terminals (>=60 cols). */
  showHint?: boolean;
}

/** Mode display config: label + color + description. */
const MODE_CONFIG: Record<PermissionMode, { label: string; color: string; description: string }> = {
  default: { label: 'BUILD', color: T.green,  description: 'full permissions per tier' },
  plan:    { label: 'PLAN',  color: T.yellow, description: 'read-only, no edits' },
  safe:    { label: 'SAFE',  color: T.blue,   description: 'read-only, no writes, no exec' },
  god:     { label: 'GOD',   color: T.red,    description: 'maximum autonomy, all gates off' },
};

/**
 * Permission mode indicator. Shows the current mode label + optional
 * keybind hint to cycle modes.
 *
 * On narrow terminals (<60 cols), the hint is hidden to save space.
 */
export function ApprovalModeIndicator({
  mode,
  godMode = false,
  cols,
  showHint,
}: Props): React.ReactElement {
  // godMode overrides whatever mode is set.
  const effectiveMode: PermissionMode = godMode ? 'god' : mode;
  const config = MODE_CONFIG[effectiveMode];
  const hintEnabled = showHint ?? cols >= 60;

  return (
    <Box flexDirection="row">
      <Text color={config.color} bold>
        {config.label}
      </Text>
      {hintEnabled && (
        <Text color={T.gray} dimColor>
          {' '}
          (Shift+Tab to cycle)
        </Text>
      )}
    </Box>
  );
}

/** Exposed for tests. */
export const __testing = { MODE_CONFIG };
