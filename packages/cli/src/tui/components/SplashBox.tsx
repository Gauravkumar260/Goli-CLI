/**
 * components/SplashBox.tsx — Full design splash (matches docs/GoliCLI.jsx).
 *
 * Layout:
 *   ┌─ Goli-CLI v1.0.0 ─────────────────── 312ms ┐
 *   │                                              │
 *   │  ┌─ left col (28w) ─┬─ right col ─────────┐ │
 *   │  │  GOLI art        │ Available Agents    │ │
 *   │  │  Multi-Agent AI Coding │ TypeScript + Bun │ claude-sonnet-4-6   │ │
 *   │  │  🛡 SAFE MODE │ (Ctrl+G to toggle)                              │ │
 *   │  │  Permission Tier │ T0 [T1] T2 T3 BLK │ read + write │ (/tier ...)   │ │
 *   │  │                  │ ai: ...             │ │
 *   │  │                  │ fullstack: ...      │ │
 *   │  │                  │ research: ...       │ │
 *   │  │                  │ (and 2 more...)     │ │
 *   │  │                  │ 8 agents · 6 skills │ │
 *   │  │                  │ ⚠ update available  │ │
 *   │  └──────────────────┴─────────────────────┘ │
 *   │                                              │
 *   │  F:\Desktop\project\Goli-CLI-updates\...     │
 *   │  Session: 20260628_141911_g0l1c1              │
 *   │                                              │
 *   │  ⚕ claude-sonnet-4-6:cloud │ 0/200K │       │
 *   │  [bar] 0% │ SAFE │ T1 │ ⏱ 0.0s              │
 *   └──────────────────────────────────────────────┘
 *
 * Responsive:
 *   cols ≥ 100 → 2-column body (left + right side-by-side)
 *   cols ≥ 60  → stacked (left on top, right below)
 *   cols <  60 → minimal: header + path + token bar (left/right hidden)
 *
 * When the conversation starts, App.tsx unmounts this and
 * shows the compact HeaderBar instead — see App.tsx's
 * `showDesign` flag.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { APP_VERSION } from '../../constants.js';
import {
  ART, AGENTS, SKILLS,
  MODES, getModeColor, getModeDesc,
  type AppMode,
} from '../theme/agents.js';
import { useSecsTick } from '../hooks/useSecsTick.js';
import { TokenBar, tokPct, formatTokenLimit } from './TokenBar.js';

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
  /** When false, suppress the "⚠ update available" indicator. */
  updateAvailable?: boolean;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
}

// Pre-computed static data (module-scope, allocated once)
const ART_LINES = ART.split('\n');
const SEP = T.border;
const Sep = (): React.ReactElement => <Text color={SEP}> │ </Text>;

function SplashBoxImpl(props: Props): React.ReactElement | null {
  const {
    cols, model, workspace, branch, sessionId, mode, tier, appMode,
    tokens, tokenLimit, bootstrapMs = 312, updateAvailable = false,
    bordered = true,
  } = props;
  const [secs] = useSecsTick();

  const wide = cols >= 100;
  const narrow = cols < 60;

  const tc = getModeColor(appMode ?? 'build');
  const sessionShort = sessionId.slice(0, 8);
  const tokenLimitStr = formatTokenLimit(tokenLimit);
  const secsStr = secs.toFixed(1);

  return (
    <Box
      flexDirection="column"
      {...(bordered
        ? { borderStyle: 'round' as const, borderColor: T.border }
        : {})}
      paddingX={1}
    >
      {/* ── Header strip ─────────────────────────────────────────────
          Left: Goli-CLI v1.0.0     Right: bootstrap ms */}
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

      {/* ── Body ─────────────────────────────────────────────────── */}
      {!narrow && (
        <Box flexDirection={wide ? 'row' : 'column'} marginTop={1}>
          {wide && <LeftCol />}
          <Box flexDirection="column" flexGrow={1} marginLeft={wide ? 2 : 0}>
            {wide ? (
              <RightCol model={model} mode={mode} tier={tier} appMode={appMode} updateAvailable={updateAvailable} />
            ) : (
              <>
                <LeftCol />
                <Box marginTop={1}><RightCol model={model} mode={mode} tier={tier} appMode={appMode} updateAvailable={updateAvailable} /></Box>
              </>
            )}
          </Box>
        </Box>
      )}

      {/* ── Path / session strip ──────────────────────────────────── */}
      <Box flexDirection="row" justifyContent="space-between" marginTop={narrow ? 1 : 0}>
        <Text color={T.yellow}>
          {workspace}{branch ? ` · ${branch}` : ''}
        </Text>
        {!narrow && (
          <Text>
            <Text color={T.gray}>Session: </Text>
            <Text color={T.gray}>{sessionShort}</Text>
          </Text>
        )}
      </Box>

      {/* ── Token / status bar ────────────────────────────────────── */}
      <Box flexWrap="wrap" marginTop={0}>
        <Text color={T.purple}>{String.fromCharCode(0x2695)}</Text>
        <Text> </Text>
        <Text color={T.purple}>{model}</Text>
        <Sep />
        <Text>{tokens.toLocaleString()}/{tokenLimitStr}</Text>
        <Sep />
        <TokenBar tokens={tokens} tokenLimit={tokenLimit} />
        <Sep />
        <Text color={mode === 'GOD' ? T.red : T.green}>{mode}</Text>
        <Sep />
        <Text color={tc}>{appMode ?? 'build'}</Text>
        <Sep />
        <Text>⏱ {secsStr}s</Text>
        {/* '⚠ update available' is shown in the right-column footer above */}
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

// ─── Left column: GOLI art only (sub-labels, mode toggle, and tier picker
//                              all live in RightCol now)
const LeftCol = React.memo(function LeftCol(): React.ReactElement {
  return (
    <Box flexDirection="column" width={56} flexShrink={0}>
      {/* GOLI art at full width — no labels next to it so nothing truncates */}
      <Box flexDirection="column">
        {ART_LINES.map((line, i) => (
          <Text key={i} wrap="truncate-end" color={i % 2 === 0 ? T.teal : T.purple}>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
});

// ─── Right column: agents line + sub-labels + mode toggle + tier picker ────
const RightCol = React.memo(function RightCol({
  model, mode, tier, appMode, updateAvailable,
}: {
  model: string;
  mode: Mode;
  tier: string;
  /** T-MODE: The current permission mode. */
  appMode?: AppMode;
  updateAvailable?: boolean;
}): React.ReactElement {
  // Strip the ":cloud" suffix and any ":<provider>" tail so the badge stays short
  const shortModel = model.split(':')[0] ?? model;
  return (
    <Box flexDirection="column">
      {/* Agents / skills / help line */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={T.teal}>{AGENTS.length} agents · {SKILLS.length} skills</Text>
          <Text color={T.gray}> · /help for commands</Text>
        </Text>
      </Box>

      {/* Sub-labels row — directly under the agents/skills line */}
      <Box flexDirection="row" marginTop={1} flexWrap="wrap">
        <Text color={T.gray}>Multi-Agent AI Coding</Text>
        <Sep />
        <Text color={T.gray}>TypeScript + Bun</Text>
        <Sep />
        <Text color={T.gray}>{shortModel}</Text>
      </Box>

      {/* Mode toggle row — button + hint on a single horizontal line */}
      <Box flexDirection="row" marginTop={1}>
        <Text color={mode === 'GOD' ? T.red : T.green}>
          {' '}{mode === 'GOD' ? '⚡ GOD MODE' : '🛡 SAFE MODE'}{' '}
        </Text>
        <Sep />
        <Text color={T.gray} dimColor>(Ctrl+G to toggle)</Text>
      </Box>

      {/* T-MODE: Mode picker row — label + chips + description + hint */}
      <Box flexDirection="row" marginTop={1} flexWrap="wrap">
        <Text color={T.gray} dimColor>Mode</Text>
        <Sep />
        <Box flexDirection="row">
          {MODES.map((m) => {
            const active = m.id === (appMode ?? 'build');
            return (
              <Text key={m.id} color={active ? m.c : T.gray}>
                {active ? '[' : ' '}{m.id}{active ? ']' : ' '}{' '}
              </Text>
            );
          })}
        </Box>
        <Sep />
        <Text color={T.gray}>{getModeDesc(appMode ?? 'build')}</Text>
        <Sep />
        <Text color={T.gray} dimColor>(/mode read-only|plan|build|god)</Text>
      </Box>

      {updateAvailable !== false && (
        <Box flexDirection="row" justifyContent="flex-end" marginTop={1}>
          <Text color={T.yellow}>⚠ update available</Text>
        </Box>
      )}
    </Box>
  );
});
