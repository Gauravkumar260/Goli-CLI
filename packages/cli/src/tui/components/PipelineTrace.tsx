/**
 * components/PipelineTrace.tsx — Animated 3-step thinking trace (memoized).
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { SPIN } from '../theme/agents.js';
import { useSpinIndex } from '../hooks/useSpinIndex.js';
import { useSecsTick } from '../hooks/useSecsTick.js';

interface Props {
  activeAgent: string;
  step: number;
}

function PipelineTraceImpl({ activeAgent, step }: Props): React.ReactElement {
  const [secs] = useSecsTick();
  const secsStr = secs.toFixed(1);
  const spinIdx = useSpinIndex();
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={T.gray} dimColor>Routing to <Text color={T.teal}>{activeAgent}</Text>...</Text>

      {step >= 1 && (
        <Box>
          <Text color={T.border}>{String.fromCharCode(0x250A)}</Text>
          <Text> </Text>
          <Text color={T.blue}>⚡</Text>
          <Text> </Text>
          <Text color={T.gray}>analyzing request ({secsStr}s)</Text>
        </Box>
      )}
      {step >= 2 && (
        <Box>
          <Text color={T.border}>{String.fromCharCode(0x250A)}</Text>
          <Text> </Text>
          <Text>🤖</Text>
          <Text> </Text>
          <Text color={T.gray}>routing agent pipeline ({secsStr}s)</Text>
        </Box>
      )}
      {step >= 3 && (
        <Box>
          <Text color={T.border}>{String.fromCharCode(0x250A)}</Text>
          <Text> </Text>
          <Text color={T.yellow}>{SPIN[spinIdx]}</Text>
          <Text> </Text>
          <Text color={T.gray}>generating response</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 *
 */
export const PipelineTrace = React.memo(PipelineTraceImpl);
