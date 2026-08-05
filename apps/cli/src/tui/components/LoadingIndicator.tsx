/**
 * components/LoadingIndicator.tsx — Composed loading indicator (T-057).
 *
 * Reference: gemini-cli's `LoadingIndicator.tsx` (183 lines) composes
 * spinner + currentLoadingPhrase + wittyPhrase + elapsedTime + cancel
 * hint into a single row. We mirror this pattern using our existing
 * Spinner + textConstants.
 *
 * Features:
 *   - Animated spinner (with screen-reader fallback via Spinner's altText)
 *   - Current loading phrase ("Working", "Thinking", "Processing"...)
 *   - Optional witty phrase (cycled occasionally for delight)
 *   - Elapsed time display ("12s")
 *   - Cancel hint ("(esc to cancel)")
 *   - Optional thought subject ("analyzing src/auth.ts")
 *   - Narrow-width aware (collapses to spinner + phrase only)
 *
 * Usage:
 *   <LoadingIndicator cols={80} startTime={Date.now()} onCancel={() => {}} />
 *   <LoadingIndicator cols={80} startTime={Date.now()} thought="analyzing auth" />
 *
 * @module tui/components/LoadingIndicator
 */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { Spinner, type SpinnerStyle } from './Spinner.js';
import { useIsScreenReaderEnabled } from '../hooks/useIsScreenReaderEnabled.js';
import {
  LOADING_PHRASES,
  WITTY_PHRASES,
  SCREEN_READER_LOADING,
  SCREEN_READER_RESPONDING,
} from '../lib/textConstants.js';

interface Props {
  /** Terminal width in columns. */
  cols: number;
  /** When loading started (Date.now()). Used for elapsed time. */
  startTime: number;
  /** Optional callback when user presses Esc (cancel hint shown if provided). */
  onCancel?: () => void;
  /** Optional subject of the agent's current thought (e.g. "analyzing auth"). */
  thought?: string;
  /** Spinner style. Defaults to 'dots'. Includes T-088 kawaii styles. */
  spinnerStyle?: SpinnerStyle;
  /** Use gradient spinner (5-color brand cycling). Defaults to false. */
  gradient?: boolean;
  /** Show witty phrases (cycled occasionally). Defaults to true on wide terminals. */
  showWitty?: boolean;
  /** Update interval for elapsed time (ms). Defaults to 1000 (1s). */
  tickMs?: number;
  /** Phrase cycle interval (ms). Defaults to 3000 (3s). */
  phraseCycleMs?: number;
}

/** Format milliseconds as "Ns" or "Nm Ns". */
function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

/**
 * Composed loading indicator. Renders a single row:
 *   `<spinner> <phrase> [<thought>] [<witty>] <elapsed> (esc to cancel)`
 *
 * In screen-reader mode: renders `<SCREEN_READER_LOADING> (<elapsed>)` with
 * no animation, no witty phrases (verbose humor is annoying via TTS).
 *
 * On narrow terminals (<50 cols): collapses to `<spinner> <phrase> <elapsed>`.
 */
export function LoadingIndicator({
  cols,
  startTime,
  onCancel,
  thought,
  spinnerStyle = 'dots',
  gradient = false,
  showWitty,
  tickMs = 1000,
  phraseCycleMs = 3000,
}: Props): React.ReactElement {
  const srEnabled = useIsScreenReaderEnabled();
  const [elapsed, setElapsed] = useState(() => Date.now() - startTime);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [wittyIdx, setWittyIdx] = useState(0);

  // Tick the elapsed time every tickMs.
  useEffect(() => {
    if (srEnabled) return; // SR mode: no ticking (static display).
    const id = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, tickMs);
    return () => clearInterval(id);
  }, [startTime, tickMs, srEnabled]);

  // Cycle the loading phrase every phraseCycleMs.
  useEffect(() => {
    if (srEnabled) return;
    const id = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % LOADING_PHRASES.length);
      // Cycle witty phrase less frequently (every 2nd phrase change).
      setWittyIdx((i) => (i + 1) % WITTY_PHRASES.length);
    }, phraseCycleMs);
    return () => clearInterval(id);
  }, [phraseCycleMs, srEnabled]);

  // Determine narrow mode.
  const narrow = cols < 50;
  // Show witty phrases only on wide terminals and when not in SR mode.
  const wittyEnabled = !srEnabled && (showWitty ?? cols >= 70);
  // Show thought only on wide terminals.
  const showThought = thought && cols >= 60;

  // Screen-reader mode: static, verbose, no animation.
  if (srEnabled) {
    return (
      <Box flexDirection="row">
        <Text bold>
          {thought ? SCREEN_READER_RESPONDING : SCREEN_READER_LOADING}
        </Text>
        <Text> ({formatElapsed(elapsed)})</Text>
        {onCancel && (
          <Text color={T.gray}> (press Escape to cancel)</Text>
        )}
      </Box>
    );
  }

  const phrase = LOADING_PHRASES[phraseIdx % LOADING_PHRASES.length]!;
  const witty = wittyEnabled ? WITTY_PHRASES[wittyIdx % WITTY_PHRASES.length]! : null;

  return (
    <Box flexDirection="row">
      <Spinner
        style={spinnerStyle}
        gradient={gradient}
        altText={SCREEN_READER_LOADING}
      />
      <Text> </Text>
      <Text color={T.fg} bold>{phrase}</Text>
      {showThought && (
        <Text color={T.gray} dimColor> [{thought}]</Text>
      )}
      {witty && (
        <Text color={T.purple} dimColor> — {witty}</Text>
      )}
      {!narrow && (
        <Text color={T.gray}> {formatElapsed(elapsed)}</Text>
      )}
      {onCancel && !narrow && (
        <Text color={T.gray} dimColor> (esc to cancel)</Text>
      )}
    </Box>
  );
}

/** Exposed for tests. */
export const __testing = { formatElapsed };
