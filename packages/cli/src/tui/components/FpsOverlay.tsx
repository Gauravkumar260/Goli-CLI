/**
 * components/FpsOverlay.tsx — Debug overlay showing live FPS.
 *
 * Ported from hermes-agent's `ui-tui/src/components/fpsOverlay.tsx`.
 * Themed with goli's existing `T` palette (no design change), gated
 * behind `GOLI_TUI_FPS=1` so the default TUI render is byte-identical
 * to today.
 *
 * Layout matches the hermes original:
 *   "{fps} fps · {lastDurationMs} ms · #{totalFrames}"
 *
 * Zero-pad widths so digit churn doesn't jitter the right edge of the
 * status bar.
 *
 * Memoized — this is rendered as part of the status bar, and FPS
 * updates fire many times per second when streaming. The component
 * should NOT cause the surrounding chrome to re-render.
 */
import React, { memo, useEffect, useState } from 'react';
import { Text } from 'ink';
import { T } from '../theme/tokens.js';
import {
  isFpsEnabled,
  subscribeFps,
  type FpsState,
} from '../lib/fpsStore.js';

interface FpsOverlayProps {
  /** Optional override of the default fg colour (debugging) — falls back to gray when low fps. */
  variant?: 'status' | 'warn' | 'error';
}

function colorFor(s: FpsState, variant?: FpsOverlayProps['variant']): string {
  if (variant === 'warn') return T.yellow;
  if (variant === 'error') return T.red;
  if (s.fps >= 50) return T.green;
  if (s.fps >= 30) return T.yellow;
  return T.red;
}

function FpsOverlayImpl({ variant }: FpsOverlayProps): React.ReactElement | null {
  const [s, setS] = useState<FpsState>(() => ({
    fps: 0,
    lastDurationMs: 0,
    totalFrames: 0,
  }));

  useEffect(() => {
    return subscribeFps(setS);
  }, []);

  // Zero-padded widths — fps to 1dp but always 4 chars wide
  // ("0.0", "10.5", "120.0"), duration to 1dp always 5 chars wide
  // ("0.0", "12.5", "120.0"), frame count zero-padded to 6.
  const fpsStr = (s.fps === 0 ? '0.0' : s.fps.toFixed(1)).padStart(5);
  const msStr = (s.lastDurationMs === 0 ? '0.0' : s.lastDurationMs.toFixed(1)).padStart(5);
  const frameStr = String(s.totalFrames).padStart(6);

  return (
    <Text color={colorFor(s, variant)}>
      {fpsStr}fps · {msStr}ms · #{frameStr}
    </Text>
  );
}

/**
 *
 */
export const FpsOverlay = memo(FpsOverlayImpl);

/**
 * Convenience wrapper so call sites don't have to gate on the env var
 * themselves. Renders `null` (zero output) when disabled, so positioning
 * it inline in the status bar affects nothing in the default TUI.
 */
export function MaybeFpsOverlay(
  props: FpsOverlayProps & { when?: boolean },
): React.ReactElement | null {
  if (props.when === false) return null;
  if (!isFpsEnabled()) return null;
  return <FpsOverlay {...props} />;
}
