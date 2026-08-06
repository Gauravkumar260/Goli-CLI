/**
 * Tests for shell inactivity / stuck-operation UX (T-063).
 *
 * Covers:
 *   - useInactivityTimer: basic timer, trigger reset, isActive false, delay
 *   - hasRedirection: detects >, >>, |, 2>&1, trailing &
 *   - useTurnActivityMonitor: operationStartTime resets on Responding transition,
 *     isRedirectionActive derived from pending tool calls
 *   - useShellInactivityStatus: focus hint, action_required, silent_working
 *
 * Uses vi.useFakeTimers for deterministic timing. Hook tests use a small
 * wrapper component + ink-testing-library. The wrapper writes the hook's
 * result as text, and assertions read it via `lastFrame()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';

import { useInactivityTimer } from '../src/tui/hooks/useInactivityTimer.js';
import {
  hasRedirection,
  useTurnActivityMonitor,
  type MinimalTrackedToolCall,
  type StreamingState,
} from '../src/tui/hooks/useTurnActivityMonitor.js';
import {
  useShellInactivityStatus,
  SHELL_FOCUS_HINT_DELAY_MS,
  SHELL_ACTION_REQUIRED_TITLE_DELAY_MS,
  SHELL_SILENT_WORKING_TITLE_DELAY_MS,
} from '../src/tui/hooks/useShellInactivityStatus.js';

// ─── useInactivityTimer ───────────────────────────────────────────────────

describe('T-063: useInactivityTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false initially when isActive is true', async () => {
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(true, 'x', 5000);
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('false');
  });

  it('returns true after delayMs elapses without trigger change', async () => {
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(true, 'x', 5000);
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(5001);
    expect(lastFrame()).toContain('true');
  });

  it('returns false when isActive is false', async () => {
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(false, 'x', 5000);
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(10000);
    expect(lastFrame()).toContain('false');
  });

  it('resets the timer when trigger changes (within the delay)', async () => {
    let trigger = 'a';
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(true, trigger, 5000);
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame, rerender } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(3000);
    expect(lastFrame()).toContain('false');
    // Change trigger — should reset.
    trigger = 'b';
    rerender(<Comp />);
    await vi.advanceTimersByTimeAsync(3000);
    expect(lastFrame()).toContain('false');
    await vi.advanceTimersByTimeAsync(2001);
    expect(lastFrame()).toContain('true');
  });

  it('returns false when isActive transitions from true to false', async () => {
    let isActive = true;
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(isActive, 'x', 5000);
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame, rerender } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(3000);
    isActive = false;
    rerender(<Comp />);
    expect(lastFrame()).toContain('false');
  });

  it('uses default delayMs of 5000 when not specified', async () => {
    function Comp(): React.ReactElement {
      const r = useInactivityTimer(true, 'x');
      return <Text>{String(r)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(4999);
    expect(lastFrame()).toContain('false');
    await vi.advanceTimersByTimeAsync(2);
    expect(lastFrame()).toContain('true');
  });
});

// ─── hasRedirection ───────────────────────────────────────────────────────

describe('T-063: hasRedirection', () => {
  it('detects ">" redirection', async () => {
    expect(hasRedirection('echo hi > out.txt')).toBe(true);
  });

  it('detects ">>" append redirection', async () => {
    expect(hasRedirection('echo hi >> out.txt')).toBe(true);
  });

  it('detects "|" pipe', async () => {
    expect(hasRedirection('cat foo | grep bar')).toBe(true);
  });

  it('detects "2>&1" stderr-to-stdout', async () => {
    expect(hasRedirection('npm test 2>&1')).toBe(true);
  });

  it('detects trailing "&" (background)', async () => {
    expect(hasRedirection('sleep 600 &')).toBe(true);
  });

  it('returns false for a plain command', async () => {
    expect(hasRedirection('npm test')).toBe(false);
  });

  it('returns false for an empty string', async () => {
    expect(hasRedirection('')).toBe(false);
  });

  it('returns false for a command with no operators', async () => {
    expect(hasRedirection('git status')).toBe(false);
    expect(hasRedirection('ls -la')).toBe(false);
  });
});

// ─── useTurnActivityMonitor ───────────────────────────────────────────────

describe('T-063: useTurnActivityMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an operationStartTime > 0 and isRedirectionActive=false when no pending tools', async () => {
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Idle', null, []);
      return <Text>{r.operationStartTime}|{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    const frame = lastFrame() ?? '';
    const [timeStr, redirStr] = frame.split('|');
    expect(Number(timeStr)).toBeGreaterThan(0);
    expect(redirStr).toBe('false');
  });

  it('resets operationStartTime when streamingState transitions to Responding', async () => {
    let streamingState: StreamingState = 'Idle';
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor(streamingState, null, []);
      return <Text>{r.operationStartTime}</Text>;
    }
    const { lastFrame, rerender } = render(<Comp />);
    const initialTime = Number(lastFrame() ?? '0');
    await vi.advanceTimersByTimeAsync(5000);
    streamingState = 'Responding';
    rerender(<Comp />);
    // Flush the useEffect that resets operationStartTime.
    await vi.advanceTimersByTimeAsync(0);
    const afterTime = Number(lastFrame() ?? '0');
    expect(afterTime).toBeGreaterThan(initialTime);
  });

  it('does NOT reset operationStartTime when streamingState stays Responding', async () => {
    let streamingState: StreamingState = 'Responding';
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor(streamingState, null, []);
      return <Text>{r.operationStartTime}</Text>;
    }
    const { lastFrame, rerender } = render(<Comp />);
    const initialTime = Number(lastFrame() ?? '0');
    await vi.advanceTimersByTimeAsync(5000);
    streamingState = 'Responding';
    rerender(<Comp />);
    await vi.advanceTimersByTimeAsync(0);
    const afterTime = Number(lastFrame() ?? '0');
    expect(afterTime).toBe(initialTime);
  });

  it('isRedirectionActive is false when no pending tool calls', async () => {
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Responding', null, []);
      return <Text>{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('false');
  });

  it('isRedirectionActive is false when pending tool call has no redirection', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'run_shell_command', args: { command: 'npm test' } },
    ];
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Responding', null, pending);
      return <Text>{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('false');
  });

  it('isRedirectionActive is true when pending run_shell_command has ">"', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'run_shell_command', args: { command: 'echo hi > out.txt' } },
    ];
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Responding', null, pending);
      return <Text>{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('true');
  });

  it('isRedirectionActive is true when pending bash tool has a pipe', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'bash', args: { command: 'cat foo | grep bar' } },
    ];
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Responding', null, pending);
      return <Text>{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('true');
  });

  it('isRedirectionActive ignores non-shell tool calls', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'write_file', args: { path: 'foo.txt', content: 'hi > there' } },
    ];
    function Comp(): React.ReactElement {
      const r = useTurnActivityMonitor('Responding', null, pending);
      return <Text>{String(r.isRedirectionActive)}</Text>;
    }
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('false');
  });
});

// ─── useShellInactivityStatus ─────────────────────────────────────────────

describe('T-063: useShellInactivityStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: build a component that calls the hook with the given props.
  // `lastOutputTime` should be > operationStartTime for hasProducedOutput=true.
  // We set lastOutputTime to (Date.now() + 1000) to guarantee it's after.
  function makeComp(props: {
    activePtyId?: number | string | null;
    lastOutputTime?: number;
    streamingState?: StreamingState;
    pendingToolCalls?: MinimalTrackedToolCall[];
    embeddedShellFocused?: boolean;
    isInteractiveShellEnabled?: boolean;
  }) {
    return function Comp(): React.ReactElement {
      const r = useShellInactivityStatus({
        activePtyId: props.activePtyId !== undefined ? props.activePtyId : 1,
        // Default: a time clearly after operationStartTime (which is set to Date.now() on mount).
        // We use a large future timestamp to guarantee hasProducedOutput=true.
        lastOutputTime: props.lastOutputTime ?? 9999999999999,
        streamingState: props.streamingState ?? 'Responding',
        pendingToolCalls: props.pendingToolCalls ?? [],
        embeddedShellFocused: props.embeddedShellFocused ?? false,
        isInteractiveShellEnabled: props.isInteractiveShellEnabled ?? true,
      });
      return (
        <Text>
          {r.shouldShowFocusHint ? 'HINT' : 'NOHINT'}|{r.inactivityStatus}
        </Text>
      );
    };
  }

  it('returns none + NOHINT initially when shell is awaiting focus', async () => {
    const Comp = makeComp({});
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('NOHINT');
    expect(lastFrame()).toContain('none');
  });

  it('shouldShowFocusHint becomes true after SHELL_FOCUS_HINT_DELAY_MS when output was produced', async () => {
    const Comp = makeComp({});
    const { lastFrame } = render(<Comp />);
    expect(lastFrame()).toContain('NOHINT');
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS + 100);
    expect(lastFrame()).toContain('HINT');
  });

  it('shouldShowFocusHint takes 4x longer when no output was produced', async () => {
    // lastOutputTime=0 means no output (0 < operationStartTime).
    const Comp = makeComp({ lastOutputTime: 0 });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS + 100);
    expect(lastFrame()).toContain('NOHINT');
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS * 3 + 100);
    expect(lastFrame()).toContain('HINT');
  });

  it('shouldShowFocusHint is false when shell is focused', async () => {
    const Comp = makeComp({ embeddedShellFocused: true });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS + 100);
    expect(lastFrame()).toContain('NOHINT');
  });

  it('shouldShowFocusHint is false when interactive shell is disabled', async () => {
    const Comp = makeComp({ isInteractiveShellEnabled: false });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS + 100);
    expect(lastFrame()).toContain('NOHINT');
  });

  it('shouldShowFocusHint is suppressed when redirection is active', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'run_shell_command', args: { command: 'echo hi > out.txt' } },
    ];
    const Comp = makeComp({ pendingToolCalls: pending });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_FOCUS_HINT_DELAY_MS * 4 + 100);
    expect(lastFrame()).toContain('NOHINT');
  });

  it('inactivityStatus becomes action_required after 30s of silence (with output)', async () => {
    const Comp = makeComp({});
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_ACTION_REQUIRED_TITLE_DELAY_MS + 100);
    expect(lastFrame()).toContain('action_required');
  });

  it('inactivityStatus is NOT action_required when redirection is active', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'run_shell_command', args: { command: 'echo hi > out.txt' } },
    ];
    const Comp = makeComp({ pendingToolCalls: pending });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_ACTION_REQUIRED_TITLE_DELAY_MS + 100);
    expect(lastFrame()).not.toContain('action_required');
  });

  it('inactivityStatus becomes silent_working after 2min of redirected output', async () => {
    const pending: MinimalTrackedToolCall[] = [
      { name: 'run_shell_command', args: { command: 'echo hi > out.txt' } },
    ];
    const Comp = makeComp({ pendingToolCalls: pending });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_SILENT_WORKING_TITLE_DELAY_MS + 100);
    expect(lastFrame()).toContain('silent_working');
  });

  it('inactivityStatus becomes silent_working after 60s of silent non-redirected output', async () => {
    // No output (lastOutputTime=0), no redirection.
    const Comp = makeComp({ lastOutputTime: 0 });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_ACTION_REQUIRED_TITLE_DELAY_MS * 2 + 100);
    expect(lastFrame()).toContain('silent_working');
  });

  it('inactivityStatus is none when no active PTY', async () => {
    const Comp = makeComp({ activePtyId: null });
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_ACTION_REQUIRED_TITLE_DELAY_MS + 100);
    expect(lastFrame()).toContain('none');
  });

  it('action_required takes priority over silent_working', async () => {
    const Comp = makeComp({});
    const { lastFrame } = render(<Comp />);
    await vi.advanceTimersByTimeAsync(SHELL_ACTION_REQUIRED_TITLE_DELAY_MS + 100);
    expect(lastFrame()).toContain('action_required');
    await vi.advanceTimersByTimeAsync(SHELL_SILENT_WORKING_TITLE_DELAY_MS);
    expect(lastFrame()).toContain('action_required');
  });
});
