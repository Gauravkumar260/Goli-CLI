/**
 * components/HeaderBar.tsx — Compact one-line header.
 *
 * Replaces the giant InfoBox for the post-launch state. Shows:
 *   Goli-CLI v1.0.0 · claude-sonnet-4-6 · SAFE · T1 · 0/200K [bar] · ⏱ 0.0s
 *
 * On wide terminals (>100 cols) it adds a soft separator and model
 * info. On narrow (<60) it drops tokens and elapsed.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { useSecsTick } from '../hooks/useSecsTick.js';
import { TokenBar, formatTokenLimit } from './TokenBar.js';

interface Props {
  cols: number;
  model: string;
  tokens: number;
  tokenLimit: number;
  mode: 'SAFE' | 'GOD';
  tier: string;
  branch?: string;
}

function HeaderBarImpl({ cols, model, tokens, tokenLimit, mode, tier, branch }: Props): React.ReactElement {
  const [secs] = useSecsTick();
  const narrow = cols < 60;

  const modeColor = mode === 'GOD' ? T.red : T.green;
  const limitStr = formatTokenLimit(tokenLimit);
  const modelShort = narrow ? model.split('-').slice(0, 2).join('-') : model;

  return (
    <Box borderStyle="round" borderColor={T.border} paddingX={1} flexWrap="wrap">
      <Text color={T.teal} bold>Goli-CLI</Text>
      <Text> </Text>
      <Text color={T.green}>v1.0.0</Text>
      {!narrow && (
        <>
          <Text color={T.border}> · </Text>
          <Text color={T.purple}>{modelShort}</Text>
        </>
      )}
      <Text color={T.border}> │ </Text>
      <Text color={modeColor}>{mode}</Text>
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
