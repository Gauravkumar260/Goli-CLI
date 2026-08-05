/**
 * components/CompactionBanner.tsx — Transient banner showing compaction info.
 *
 * P1-11 fix (remediation plan Phase 11): when `AdvancedCompressor`
 * runs during an agent loop iteration, `CliAgentLoop` emits a
 * `kind: 'compaction'` event with a `CompactionInfo` payload.
 * `useAgentLoop` pushes that into `AppStateStore.lastCompaction`, and
 * this component renders it as a bordered banner showing the token
 * delta and the layers that ran.
 *
 * The banner is auto-dismissed after 5 seconds (the user has seen the
 * summary; the system message in the transcript retains the full
 * detail). Returns `null` when there's no compaction to show.
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { T, getBorderStyle } from '../theme/tokens.js';
import type { CompactionInfo } from '../../services/IAgentLoop.js';

interface Props {
  /** The most recent compaction info, or null when none has occurred. */
  compaction: CompactionInfo | null;
  /** How long to show the banner before auto-hiding (ms). Default: 5000. */
  durationMs?: number;
}

/**
 * Render a transient compaction banner. Auto-hides after `durationMs`.
 *
 * Layout:
 *   ╭────────────────────────────────────────────────────────────────╮
 *   │ ⇄ Context compacted: 45000 → 12000 tokens (33000 reclaimed, 73%) │
 *   │   Trigger: auto · Layers: dedupe → boundaries → evict → prune →… │
 *   ╰────────────────────────────────────────────────────────────────╯
 */
export function CompactionBanner({ compaction, durationMs = 5000 }: Props): React.ReactElement | null {
  const [visible, setVisible] = useState(false);

  // Re-show the banner each time a new compaction arrives. The
  // `compaction` object identity changes on every new event (the
  // store shallow-copies the snapshot), so this effect fires once
  // per compaction. When `compaction` is null (no compaction yet),
  // the banner stays hidden.
  useEffect(() => {
    if (!compaction) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [compaction, durationMs]);

  if (!visible || !compaction) return null;

  const reclaimedPct = compaction.tokensBefore > 0
    ? Math.round((compaction.tokensReclaimed / compaction.tokensBefore) * 100)
    : 0;

  return (
    <Box
      borderStyle={getBorderStyle() as 'round'}
      borderColor={T.blue}
      paddingX={1}
      marginY={0}
      flexDirection="column"
    >
      <Box>
        <Text color={T.blue}>⇄ Context compacted: </Text>
        <Text color={T.teal}>
          {compaction.tokensBefore} → {compaction.tokensAfter} tokens
        </Text>
        <Text color={T.green}>
          {' '}({compaction.tokensReclaimed} reclaimed, {reclaimedPct}%)
        </Text>
      </Box>
      <Box>
        <Text color={T.gray} dimColor>
          {'  '}Trigger: {compaction.triggeredBy} · Layers: {compaction.layersApplied.join(' → ')}
        </Text>
      </Box>
    </Box>
  );
}
