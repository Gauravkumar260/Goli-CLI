/**
 * components/HeaderBar.tsx — Compact one-line header.
 *
 * Replaces the giant InfoBox for the post-launch state. Shows:
 *   Goli-CLI v1.0.0 · gpt-oss:120b · build · T1 · 0/200K [bar] · ⏱ 0.0s
 *
 * The mode chip displays the canonical AppMode (read-only / plan / build /
 * god) with the appropriate color. "read-only" is the SAFE mode — same
 * tool filtering, same tier (T0), the label difference is cosmetic.
 *
 * On wide terminals (>100 cols) it adds a soft separator and model
 * info. On narrow (<60) it drops tokens and elapsed.
 */
import React from 'react';
// P3-30 fix: consolidate version string
import { APP_VERSION } from '../../constants.js';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import { useSecsTick } from '../hooks/useSecsTick.js';
import { TokenBar, formatTokenLimit } from './TokenBar.js';
import { getModeColor, type AppMode } from '../theme/agents.js';

interface Props {
  cols: number;
  model: string;
  tokens: number;
  tokenLimit: number;
  /** Legacy RunMode — kept for backward compat. Prefer `appMode`. */
  mode?: 'SAFE' | 'GOD';
  tier: string;
  /** T-MODE: The current permission mode (read-only/plan/build/god). */
  appMode?: AppMode;
  branch?: string;
}

function HeaderBarImpl({ cols, model, tokens, tokenLimit, mode, tier, appMode, branch }: Props): React.ReactElement {
  const [secs] = useSecsTick();
  const narrow = cols < 60;

  // T-MODE: prefer the canonical AppMode; fall back to legacy mode.
  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');
  const modeColor = getModeColor(effectiveAppMode);
  const limitStr = formatTokenLimit(tokenLimit);
  const modelShort = narrow ? model.split('-').slice(0, 2).join('-') : model;

  return (
    <Box borderStyle={getBorderStyle() as 'round'} borderColor={T.border} paddingX={1} flexWrap="wrap">
      <Text color={T.teal} bold>Goli-CLI</Text>
      <Text> </Text>
      <Text color={T.green}>v{APP_VERSION}</Text>
      {!narrow && (
        <>
          <Text color={T.border}> · </Text>
          <Text color={T.purple}>{modelShort}</Text>
        </>
      )}
      <Text color={T.border}> │ </Text>
      <Text color={modeColor}>{effectiveAppMode}</Text>
      <Text color={T.border}> │ </Text>
      <Text color={T.teal}>{tier}</Text>
      {!narrow && (
        <>
          <Text color={T.border}> │ </Text>
          <Text>{tokens.toLocaleString()}/{limitStr}</Text>
          <Text color={T.border}> │ </Text>
          <TokenBar tokens={tokens} tokenLimit={tokenLimit} />
        </>
      )}
      <Text color={T.border}> │ </Text>
      <Text>⏱ {secs.toFixed(1)}s</Text>
      {!narrow && branch && (
        <>
          <Text color={T.border}> │ </Text>
          <Text color={T.gray}>{branch}</Text>
        </>
      )}
    </Box>
  );
}

/**
 *
 */
export const HeaderBar = React.memo(HeaderBarImpl);
