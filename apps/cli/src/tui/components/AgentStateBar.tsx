/**
 * components/AgentStateBar.tsx — Pipeline status strip.
 *
 * Layout (matches docs/GoliCLI.jsx):
 *   AgentStateBar │ ● orchestrator ○ coder ○ reviewer ... │ build │ T1 │ ⠋ PLAN
 *
 * The mode chip displays the canonical AppMode (read-only / plan / build /
 * god) with the appropriate color via `getModeColor()`. "read-only" is
 * the SAFE mode — same tool filtering, same tier (T0).
 *
 * Each agent pair is rendered as its own inline group so Ink
 * keeps the dot and label adjacent. The spinner glyph uses
 * useSpinIndex (own subscription) so this component re-renders
 * in isolation at 10fps.
 *
 * P1-10 fix (remediation plan Phase 10): the bar now consumes the
 * full 7-phase `AgentPhase` model ('IDLE' | 'INIT' | 'PLAN' | 'TOOL' |
 * 'GEN' | 'ERROR' | 'DONE') instead of a binary `busy: boolean`.
 * The `busy` prop is retained for backward compat (any phase other
 * than IDLE/DONE/ERROR implies busy=true), but the displayed label
 * and spinner color now reflect the specific phase — so the user
 * sees "⠋ PLAN" while the model is analyzing the prompt, "⠋ TOOL"
 * while a tool is executing, "⠋ GEN" while the model is generating
 * the final response, etc.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import { AGENTS, getTierColor, getModeColor, SPIN, type TierId, type AppMode } from '../theme/agents.js';
import { useSpinIndex } from '../hooks/useSpinIndex.js';
import type { AgentPhase } from '../state/types.js';

/**
 * Legacy RunMode — kept for backward compat. Prefer `appMode` (AppMode).
 */
export type Mode = 'SAFE' | 'GOD';

/**
 * P1-10 fix: Per-phase display config.
 *
 * Maps each `AgentPhase` value to:
 *   - `label`: the user-visible phase name (e.g. "Planning")
 *   - `color`: the Ink color token to use for the spinner + label
 *   - `icon`: a single-character glyph prefix (optional)
 *   - `busy`: whether this phase counts as "busy" for the legacy
 *     `busy: boolean` prop (true for active phases, false for
 *     terminal/idle phases)
 *
 * The labels are short (≤10 chars) so the bar fits in narrow terminals.
 */
const PHASE_CONFIG: Record<AgentPhase, { label: string; color: string; icon: string; busy: boolean }> = {
  IDLE:  { label: 'idle',      color: T.gray,   icon: '○', busy: false },
  INIT:  { label: 'starting',  color: T.teal,   icon: '◐', busy: true  },
  PLAN:  { label: 'planning',  color: T.blue,   icon: '▶', busy: true  },
  TOOL:  { label: 'tool call', color: T.yellow, icon: '⏵', busy: true  },
  GEN:   { label: 'generating',color: T.teal,   icon: '∿', busy: true  },
  ERROR: { label: 'error',     color: T.red,    icon: '✗', busy: false },
  DONE:  { label: 'done',      color: T.green,  icon: '✓', busy: false },
};

interface Props {
  cols: number;
  activeAgents: string[];
  /** Legacy RunMode — kept for backward compat. Prefer `appMode`. */
  mode?: Mode;
  tier: TierId;
  /** T-MODE: The current permission mode (read-only/plan/build/god). */
  appMode?: AppMode;
  /**
   * Legacy busy indicator. When `phase` is also supplied, `phase` wins
   * (it's strictly more informative). When `phase` is absent, the bar
   * falls back to `busy` and renders a generic "thinking" label.
   */
  busy: boolean;
  /**
   * P1-10: the current `AgentPhase` from `useAgentLoop`'s `phase` event
   * subscription. When provided, the bar renders the phase-specific
   * label + color instead of the binary "thinking"/"idle" label.
   */
  phase?: AgentPhase;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
}

const VISIBLE_AGENTS = AGENTS.slice(0, 6);
const Sep = (): React.ReactElement => <Text color={T.border}> │ </Text>;

function AgentStateBarImpl({
  cols, activeAgents, mode, tier, appMode, busy, phase, bordered = true,
}: Props): React.ReactElement {
  const narrow = cols < 60;
  const tc = getTierColor(tier);
  const spinIdx = useSpinIndex();

  // T-MODE: prefer the canonical AppMode; fall back to legacy mode.
  const effectiveAppMode: AppMode = appMode ?? (mode === 'GOD' ? 'god' : 'build');
  const modeColor = getModeColor(effectiveAppMode);

  // P1-10: derive the effective phase. If the caller didn't pass `phase`,
  // synthesize one from `busy` so the legacy contract still works.
  const effectivePhase: AgentPhase = phase ?? (busy ? 'GEN' : 'IDLE');
  const phaseCfg = PHASE_CONFIG[effectivePhase] ?? PHASE_CONFIG.IDLE!;
  const isPhaseBusy = phaseCfg.busy;

  // Build agent segments: for each visible agent, push dot + space + label.
  const agentSegments: React.ReactNode[] = [];
  for (let i = 0; i < VISIBLE_AGENTS.length; i++) {
    const a = VISIBLE_AGENTS[i]!;
    const isActive = activeAgents.includes(a.id);
    const dotColor = isActive ? a.c : T.border;
    const labelColor = isActive ? a.c : T.gray;
    if (i > 0) agentSegments.push(<Text key={`sep-${a.id}`}> </Text>);
    agentSegments.push(
      <Text key={`dot-${a.id}`} color={dotColor}>{isActive ? '●' : '○'}</Text>,
      <Text key={`sp-${a.id}`}> </Text>,
      <Text key={`lbl-${a.id}`} color={labelColor}>{a.id}</Text>,
    );
  }

  // P1-10: phase indicator (spinner + label + icon). Replaces the old
  // binary `busy ? 'thinking' : 'idle'` indicator. The spinner only
  // animates when the phase is "busy" — terminal phases (IDLE/ERROR/DONE)
  // show a static icon.
  const phaseIndicator = (
    <>
      <Text color={phaseCfg.color}>
        {isPhaseBusy ? SPIN[spinIdx] : phaseCfg.icon}
      </Text>
      <Text> </Text>
      <Text color={phaseCfg.color}>{phaseCfg.label}</Text>
    </>
  );

  if (narrow) {
    return (
      <Box
        {...(bordered ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border } : {})}
        paddingX={1}
        width={cols}
        flexWrap="wrap"
      >
        <Text color={T.gray} dimColor>⚙ agents</Text>
        <Sep />
        <Text color={T.teal}>{activeAgents.length}</Text>
        <Text color={T.gray}>/{AGENTS.length} active</Text>
        <Box flexGrow={1} />
        <Text color={modeColor}>{effectiveAppMode}</Text>
        <Sep />
        <Text color={tc}>{tier}</Text>
        <Sep />
        {phaseIndicator}
      </Box>
    );
  }

  return (
    <Box
      {...(bordered ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border } : {})}
      paddingX={1}
      width={cols}
      flexWrap="wrap"
    >
      <Text color={T.gray} dimColor>⚙ agents</Text>
      <Sep />
      {agentSegments}
      <Box flexGrow={1} />
      <Text color={modeColor}>{effectiveAppMode}</Text>
      <Sep />
      <Text color={tc}>{tier}</Text>
      <Sep />
      {phaseIndicator}
    </Box>
  );
}

/**
 *
 */
export const AgentStateBar = React.memo(AgentStateBarImpl);
