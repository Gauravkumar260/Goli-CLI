/**
 * components/AgentStateBar.tsx — Pipeline status strip.
 *
 * Layout (matches docs/GoliCLI.jsx):
 *   AgentStateBar │ ● orchestrator ○ coder ○ reviewer ... │ SAFE │ T1 │ ⠋ idle
 *
 * Each agent pair is rendered as its own inline group so Ink
 * keeps the dot and label adjacent. The spinner glyph uses
 * useSpinIndex (own subscription) so this component re-renders
 * in isolation at 10fps.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import { AGENTS, getTierColor, SPIN, type TierId } from '../theme/agents.js';
import { useSpinIndex } from '../hooks/useSpinIndex.js';
import { Spinner } from './Spinner.js';

/**
 *
 */
export type Mode = 'SAFE' | 'GOD';

interface Props {
  cols: number;
  activeAgents: string[];
  mode: Mode;
  tier: TierId;
  busy: boolean;
  /** When false, render content only — caller supplies the outer border. */
  bordered?: boolean;
}

const VISIBLE_AGENTS = AGENTS.slice(0, 6);
const Sep = (): React.ReactElement => <Text color={T.border}> │ </Text>;

function AgentStateBarImpl({
  cols, activeAgents, mode, tier, busy, bordered = true,
}: Props): React.ReactElement {
  const narrow = cols < 60;
  const tc = getTierColor(tier);
  const spinIdx = useSpinIndex();

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

  if (narrow) {
    return (
      <Box
        {...(bordered ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border } : {})}
        paddingX={1}
        {...(bordered ? { marginBottom: 1 } : {})}
        width={cols}
        flexWrap="wrap"
      >
        <Text color={T.gray} dimColor>⚙ agents</Text>
        <Sep />
        <Text color={T.teal}>{activeAgents.length}</Text>
        <Text color={T.gray}>/{AGENTS.length} active</Text>
        <Box flexGrow={1} />
        <Text color={mode === 'GOD' ? T.red : T.green}>{mode}</Text>
        <Sep />
        <Text color={tc}>{tier}</Text>
        <Sep />
        {busy ? (
          <Spinner style="dots" color={T.yellow} label="thinking" />
        ) : (
          <Text>{SPIN[spinIdx]} idle</Text>
        )}
      </Box>
    );
  }

  return (
    <Box
      {...(bordered ? { borderStyle: getBorderStyle() as 'round', borderColor: T.border } : {})}
      paddingX={1}
      {...(bordered ? { marginBottom: 1 } : {})}
      width={cols}
      flexWrap="wrap"
    >
      <Text color={T.gray} dimColor>⚙ agents</Text>
      <Sep />
      {agentSegments}
      <Box flexGrow={1} />
      <Text color={mode === 'GOD' ? T.red : T.green}>{mode}</Text>
      <Sep />
      <Text color={tc}>{tier}</Text>
      <Sep />
      {busy ? (
        <Spinner style="dots" color={T.yellow} label="thinking" />
      ) : (
        <Text>{SPIN[spinIdx]} idle</Text>
      )}
    </Box>
  );
}

/**
 *
 */
export const AgentStateBar = React.memo(AgentStateBarImpl);
