/**
 * components/DebugProfiler.tsx — Debug overlay showing render/idle/flicker stats.
 *
 * Renders inline in the status bar (next to FpsOverlay) when GOLI_TUI_DEBUG=1.
 * Otherwise renders null (zero output, zero cost).
 *
 * Display:
 *   `Renders: 1234 (total), 12 (idle), 3 (flicker)`
 *
 * Color coding:
 *   - total: warning color (yellow)
 *   - idle:   error color (red) — idle frames indicate re-render loops
 *   - flicker: error color (red) — flicker frames indicate overflow bugs
 *
 * The overlay refreshes every 4 seconds (not every frame) to avoid
 * disturbing the measurements.
 *
 * @module DebugProfiler
 */

import React, { memo, useEffect, useState } from 'react';
import { Text } from 'ink';
import { T } from '../theme/tokens.js';
import { profiler, wireFlickerToProfiler, type ProfilerSnapshot } from '../lib/debugProfiler.js';
import { isFlickerEnabled } from '../lib/flickerStore.js';

interface DebugProfilerProps {
  /** Override the auto-refresh interval (ms). Default 4000. */
  refreshIntervalMs?: number;
}

function DebugProfilerImpl({ refreshIntervalMs = 4000 }: DebugProfilerProps): React.ReactElement | null {
  const [, setTick] = useState(0);
  const [snap, setSnap] = useState<ProfilerSnapshot>(() => profiler.snapshot());

  // Mount: increment profilersActive + wire flicker handler.
  useEffect(() => {
    profiler.profilersActive++;
    const unwire = wireFlickerToProfiler();
    return () => {
      profiler.profilersActive--;
      unwire();
    };
  }, []);

  // Periodic idle-frame check (every 1s).
  useEffect(() => {
    const id = setInterval(() => {
      profiler.checkForIdleFrames();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Periodic UI refresh (every 4s — frequent enough for diagnostics,
  // infrequent enough to not disturb the measurements).
  useEffect(() => {
    if (!isFlickerEnabled()) return;
    const id = setInterval(() => {
      profiler.reportAction();
      setSnap(profiler.snapshot());
      setTick((t) => t + 1);
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);

  if (!isFlickerEnabled()) return null;

  return (
    <Text>
      <Text color={T.yellow}>Renders:</Text> {snap.numFrames} (total),{' '}
      <Text color={T.red}>{snap.totalIdleFrames} (idle)</Text>,{' '}
      <Text color={T.red}>{snap.totalFlickerFrames} (flicker)</Text>
    </Text>
  );
}

/**
 * The DebugProfiler overlay. Memoized so it doesn't re-render when its
 * parent re-renders (the internal setInterval drives all updates).
 */
export const DebugProfiler = memo(DebugProfilerImpl);

/**
 * Convenience wrapper. Renders null when GOLI_TUI_DEBUG is unset, so
 * positioning it inline in the status bar affects nothing in the default TUI.
 */
export function MaybeDebugProfiler(
  props: DebugProfilerProps & { when?: boolean },
): React.ReactElement | null {
  if (props.when === false) return null;
  if (!isFlickerEnabled()) return null;
  return <DebugProfiler {...props} />;
}
