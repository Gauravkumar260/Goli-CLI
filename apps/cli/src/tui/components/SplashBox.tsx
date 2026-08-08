/**
 * components/SplashBox.tsx — Full design splash (matches docs/GoliCLI.jsx).
 *
 * Single-column, centered layout:
 *   ┌─ Goli-CLI v0.2.0 ────────────────── 57ms startup ─┐
 *   │                                                  │
 *   │           ╔══════════════════════════╗            │  
 *   │           ║       G O L I - C L I    ║            │
 *   │           ║  Multi-Agent Software Swarm ║        │
 *   │           ╚══════════════════════════╝            │
 *   │                                                  │
 *   │  F:\...\goli-cli · main               59de24a7   │
 *   │  ⚕ model │ 0/200K │ [bar] 0%  build │ ⏱ 0.0s   │
 *   └───────────────────────────────────────────────────┘
 *
 * When the conversation starts, App.tsx unmounts this and
 * shows the compact HeaderBar instead — see App.tsx's
 * `showDesign` flag.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import { APP_VERSION } from '../../constants.js';
import { getModeColor, ART, type AppMode } from '../theme/agents.js';
import { useSecsTick } from '../hooks/useSecsTick.js';
import { TokenBar, formatTokenLimit } from './TokenBar.js';

/**
 *
 */
export type Mode = 'SAFE' | 'GOD';

interface Props {
  cols: number;
  model: string;
  workspace: string;
  branch: string;
  sessionId: string;
  mode: Mode;
  tier: string;
  /** T-MODE: The current permission mode. */
  appMode?: AppMode;
  tokens: number;
  tokenLimit: number;
  bootstrapMs?: number;
  /** When true, shows the "⚠ update available" indicator. */
  updateAvailable?: boolean;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
}

// Pre-computed static data (module-scope, allocated once)
const ART_LINES = ART.split('\n');

function SplashBoxImpl(props: Props): React.ReactElement | null {
  const {
    cols, model, workspace, branch, sessionId, mode, tier, appMode,
    tokens, tokenLimit, bootstrapMs = 312, updateAvailable = false,
    bordered = true,
  } = props;
  const [secs] = useSecsTick();

  const narrow = cols < 60;

  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');

  return (
    <Box
      flexDirection="column"
      {...(bordered
        ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border }
        : {})}
      paddingX={1}
    >
      {/* ── Header strip: left brand, right startup ms ───────────────── */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text color={T.teal} bold>Goli-CLI</Text>
          <Text> </Text>
          <Text color={T.green}>v{APP_VERSION}</Text>
        </Box>
        {!narrow && (
          <Text color={T.gray}>{bootstrapMs}ms startup</Text>
        )}
      </Box>

      {/* ── Centered art ────────────────────────────────────────────── */}
      {!narrow && (
        <Box flexDirection="row" justifyContent="center" marginTop={1}>
          <Box flexDirection="column">
            {ART_LINES.map((line, i) => (
              <Text key={i} wrap="truncate-end" color={i % 2 === 0 ? T.teal : T.purple}>
                {line}
              </Text>
            ))}
            {updateAvailable !== false && (
              <Box flexDirection="row" justifyContent="center" marginTop={1}>
                <Text color={T.yellow}>⚠ update available</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Session line: workspace · branch ─ sessionId ────────────── */}
      <Box flexDirection="row" justifyContent="space-between" width={cols ? cols - 2 : undefined} marginTop={1}>
        <Text color={T.gray} dimColor>
          {workspace}{branch && branch !== 'no-git' ? ` · ${branch}` : ''}
        </Text>
        {!narrow && <Text color={T.gray} dimColor>{sessionId.slice(0, 8)}</Text>}
      </Box>

      {/* ── Status line: model ─ tokens ─ mode ─ elapsed ────────────── */}
      <Box flexDirection="row" alignItems="center" flexWrap="wrap">
        <Text color={T.purple}>⚕</Text>
        <Text> </Text>
        <Text color={T.purple}>{model}</Text>
        <Text color={T.border}> │ </Text>
        <Text>{tokens.toLocaleString('en-US')}</Text>
        <Text color={T.gray}>/{formatTokenLimit(tokenLimit)}</Text>
        <Text color={T.border}> │ </Text>
        <TokenBar tokens={tokens} tokenLimit={tokenLimit} />
        <Text color={T.border}> │ </Text>
        <Text color={T.teal}>{tier}</Text>
        <Box flexGrow={1} />
        <Text color={getModeColor(effectiveAppMode)}>{effectiveAppMode}</Text>
        <Text color={T.border}> │ </Text>
        <Text>⏱ {secs.toFixed(1)}s</Text>
      </Box>
    </Box>
  );
}

/**
 *
 */
export const SplashBox = React.memo(SplashBoxImpl, (prev, next) => {
  return (
    prev.cols === next.cols &&
    prev.model === next.model &&
    prev.workspace === next.workspace &&
    prev.branch === next.branch &&
    prev.sessionId === next.sessionId &&
    prev.mode === next.mode &&
    prev.tier === next.tier &&
    prev.appMode === next.appMode &&
    prev.tokens === next.tokens &&
    prev.tokenLimit === next.tokenLimit &&
    prev.updateAvailable === next.updateAvailable
  );
});