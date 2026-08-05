/**
 * components/StatusBar.tsx — Bottom status bar (g-bot-bar).
 *
 * Layout (Hermes format — Reference Manual §5.6):
 *   ⚕ claude-sonnet-4-6:cloud │ 12.4K/200K │ [██████░░░░] 6% │ SAFE │ T1      ⏱ 0.0s
 *
 * Responsive breakpoints (§5.6):
 *   ≥76 cols  — Full layout (all fields)
 *   52–75 cols — Compact (fields abbreviated)
 *   <52 cols   — Minimal: model name + duration only
 *
 * Color thresholds (§5.6, directly reused):
 *   Green  < 50%
 *   Yellow 50–80%
 *   Orange 80–95%
 *   Red    ≥ 95%
 *
 * Self-subscribes to useSecsTick for the elapsed timer.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import { useSecsTick } from '../hooks/useSecsTick.js';
import { MaybeFpsOverlay } from './FpsOverlay.js';
import { MaybeDebugProfiler } from './DebugProfiler.js';
import { TokenBar } from './TokenBar.js';
import { displayPath, truncatePath } from '../lib/pathUtils.js';
import { getModeColor, type AppMode } from '../theme/agents.js';

interface Props {
  cols: number;
  model: string;
  tokens: number;
  tokenLimit: number;
  /**
   * P1-13 fix (remediation plan Phase 13): per-type token counts for
   * the 3-bar TokenBar. When provided, the StatusBar passes them
   * through to TokenBar so the user sees input/output/thinking as
   * separate bars. When absent, TokenBar falls back to the legacy
   * single-bar layout.
   */
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  /** Legacy RunMode — kept for backward compat. Prefer `appMode`. */
  mode?: 'SAFE' | 'GOD';
  tier: string;
  /** T-MODE: The current permission mode (read-only/plan/build/god). */
  appMode?: AppMode;
  /** §8.4: optional cost field (e.g. "0.0012") — shown in full layout */
  cost?: string;
  /** §8.4: optional git branch — shown in full layout */
  branch?: string;
  /**
   * T-039: current working directory — shown in full layout (tildeified +
   * shortened via displayPath). Dropped first when terminal narrows.
   */
  cwd?: string;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
  /**
   * When true, render an FPS readout after the elapsed-time chip. Off by
   * default — the existing chrome stays pixel-identical. Wired to
   * `GOLI_TUI_FPS=1` via `isFpsEnabled()` in `App.tsx`.
   */
  fpsActive?: boolean;
}

const Sep = (): React.ReactElement => <Text color={T.border}> │ </Text>;

function modelShortName(model: string): string {
  return model.split('-').slice(0, 2).join('-');
}

function StatusBarImpl({ cols, model, tokens, tokenLimit, inputTokens, outputTokens, thinkingTokens, mode, tier, appMode, cost, branch, cwd, bordered = true, fpsActive = false }: Props): React.ReactElement {
  const [secs] = useSecsTick();
  const secsStr = secs.toFixed(1);
  const limitStr = tokenLimit >= 1000 ? `${Math.floor(tokenLimit / 1000)}K` : String(tokenLimit);
  const mShort = modelShortName(model);
  // T-MODE: prefer the canonical AppMode; fall back to legacy mode+tier.
  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');
  const modeColor = getModeColor(effectiveAppMode);

  // T-039: Tildeify + shorten the cwd. Reserve ~1/3 of cols for cwd; if the
  // terminal is narrow, truncate further via truncatePath.
  const cwdDisplay = cwd ? truncatePath(displayPath(cwd), Math.min(40, Math.floor(cols / 3))) : null;

  // ─── Minimal (< 52 cols) ─────────────────────────────────────────
  if (cols < 52) {
    return (
      <Box
        flexDirection="row"
        {...(bordered
          ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border }
          : {})}
        paddingX={1}
        width={cols}
      >
        <Text color={T.purple}>{String.fromCharCode(0x2695)}</Text>
        <Text> </Text>
        <Text color={T.purple}>{mShort}</Text>
        <Box flexGrow={1} />
        <Text>⏱ {secsStr}s</Text>
      </Box>
    );
  }

  // ─── Narrow (52–75 cols) ─────────────────────────────────────────
  if (cols < 76) {
    return (
      <Box
        flexDirection="row"
        {...(bordered
          ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border }
          : {})}
        paddingX={1}
        width={cols}
        flexWrap="wrap"
      >
        <Text color={T.purple}>{String.fromCharCode(0x2695)}</Text>
        <Text> </Text>
        <Text color={T.purple}>{mShort}</Text>
        <Sep />
        <TokenBar tokens={tokens} tokenLimit={tokenLimit} inputTokens={inputTokens} outputTokens={outputTokens} thinkingTokens={thinkingTokens} />
        <Sep />
        <Text color={modeColor}>{effectiveAppMode}</Text>
        <Text> </Text>
        <Text color={T.green}>{tier}</Text>
        <Sep />
        <Text>⏱ {secsStr}s</Text>
        {fpsActive && <Sep />}
        {fpsActive && <MaybeFpsOverlay />}
        <MaybeDebugProfiler />
      </Box>
    );
  }

  // ─── Full (≥ 76 cols) ───────────────────────────────────────────
  return (
    <Box
      flexDirection="row"
      {...(bordered
        ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border }
        : {})}
      paddingX={1}
      width={cols}
      flexWrap="wrap"
    >
      <Text color={T.purple}>{String.fromCharCode(0x2695)}</Text>
      <Text> </Text>
      <Text color={T.purple}>{mShort}</Text>
      <Sep />
      <Text>{tokens.toLocaleString()}/{limitStr}</Text>
      <Sep />
      <TokenBar tokens={tokens} tokenLimit={tokenLimit} inputTokens={inputTokens} outputTokens={outputTokens} thinkingTokens={thinkingTokens} />
      <Sep />
      <Text color={modeColor}>{effectiveAppMode}</Text>
      <Sep />
      <Text color={T.green}>{tier}</Text>
      {cwdDisplay && (
        <>
          <Sep />
          <Text color={T.blue}>{cwdDisplay}</Text>
        </>
      )}
      {cost && (
        <>
          <Sep />
          <Text color={T.yellow}>${cost}</Text>
        </>
      )}
      {branch && branch !== 'no-git' && (
        <>
          <Sep />
          <Text color={T.gray}>{branch}</Text>
        </>
      )}
      <Text> </Text>
      <Box flexGrow={1} />
      <Text>⏱ {secsStr}s</Text>
      {fpsActive && <Sep />}
      {fpsActive && <MaybeFpsOverlay />}
      <MaybeDebugProfiler />
    </Box>
  );
}

/**
 *
 */
export const StatusBar = React.memo(StatusBarImpl);
