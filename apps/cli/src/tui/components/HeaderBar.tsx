/**
 * components/HeaderBar.tsx — Header with the session + status lines on the
 * right side.
 *
 * Left: brand (Goli-CLI v0.2.0 · tier). Right, two stacked lines:
 *   line 1: workspace · branch ─ sessionId
 *   line 2: ⚕ model │ tokens/limit [bar] │ mode │ ⏱ elapsed
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
  workspace: string;
  sessionId: string;
}

function HeaderBarImpl({ cols, model, tokens, tokenLimit, mode, tier, appMode, branch, workspace, sessionId }: Props): React.ReactElement {
  const [secs] = useSecsTick();
  const narrow = cols < 60;

  // T-MODE: prefer the canonical AppMode; fall back to legacy mode.
  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');
  const modeColor = getModeColor(effectiveAppMode);
  const limitStr = formatTokenLimit(tokenLimit);

  return (
    <Box borderStyle={getBorderStyle() as 'round'} borderColor={T.border} paddingX={1}>
      <Box flexDirection="row" width={cols - 2}>
        {/* Left: brand */}
        <Box flexDirection="row" flexGrow={1} alignItems="center">
          <Text color={T.teal} bold>Goli-CLI</Text>
          <Text> </Text>
          <Text color={T.green}>v{APP_VERSION}</Text>
          <Text color={T.border}> │ </Text>
          <Text color={T.teal}>{tier}</Text>
        </Box>

        {/* Right: session strip + status strip */}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={T.gray} dimColor>
              {workspace}{branch && branch !== 'no-git' ? ` · ${branch}` : ''}
            </Text>
            {!narrow && (
              <Text color={T.gray} dimColor>{sessionId.slice(0, 8)}</Text>
            )}
          </Box>
          <Box flexDirection="row" alignItems="center" flexWrap="wrap">
            <Text color={T.purple}>⚕</Text>
            <Text> </Text>
            <Text color={T.purple}>{model}</Text>
            <Text color={T.border}> │ </Text>
            <Text>{tokens.toLocaleString('en-US')}</Text>
            <Text color={T.gray}>/{limitStr}</Text>
            <Text color={T.border}> │ </Text>
            <TokenBar tokens={tokens} tokenLimit={tokenLimit} />
            <Box flexGrow={1} />
            <Text color={modeColor}>{effectiveAppMode}</Text>
            <Text color={T.border}> │ </Text>
            <Text>⏱ {secs.toFixed(1)}s</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/**
 *
 */
export const HeaderBar = React.memo(HeaderBarImpl);
