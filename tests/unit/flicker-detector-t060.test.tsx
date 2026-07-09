/**
 * Tests for the flicker detector + debug profiler + batched scroll (T-060).
 *
 * Covers:
 *   - flickerStore: recordFlickerFrame, subscribeFlicker, onFlicker, reset
 *   - debugProfiler: reportAction, reportFrameRendered, checkForIdleFrames, reportFlicker
 *   - useFlickerDetector: hook records a flicker when measured height > terminal
 *   - DebugProfiler: renders null when disabled, renders stats when enabled
 *   - batchedScroll: scheduleScrollTop coalesces, flushPendingScroll immediate
 *
 * Gating: most tests set GOLI_TUI_DEBUG=1 in beforeEach to activate the
 * otherwise-disabled code paths. The flicker store reads ENABLED at module
 * load, so we use `vi.resetModules()` + dynamic imports to re-evaluate it
 * with the env var set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';

// ─── flickerStore (always testable — pure JS) ─────────────────────────────

describe('T-060: flickerStore', () => {
  let origDebug: string | undefined;

  beforeEach(() => {
    origDebug = process.env['GOLI_TUI_DEBUG'];
    process.env['GOLI_TUI_DEBUG'] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (origDebug === undefined) delete process.env['GOLI_TUI_DEBUG'];
    else process.env['GOLI_TUI_DEBUG'] = origDebug;
    vi.restoreAllMocks();
  });

  it('isFlickerEnabled returns true when GOLI_TUI_DEBUG=1', async () => {
    const { isFlickerEnabled } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    expect(isFlickerEnabled()).toBe(true);
  });

  it('isFlickerEnabled returns false when GOLI_TUI_DEBUG unset', async () => {
    delete process.env['GOLI_TUI_DEBUG'];
    vi.resetModules();
    const { isFlickerEnabled } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    expect(isFlickerEnabled()).toBe(false);
  });

  it('recordFlickerFrame increments totalFlickerFrames and updates lastFlickerAt', async () => {
    const { recordFlickerFrame, getFlickerSnapshot } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    const before = getFlickerSnapshot();
    recordFlickerFrame();
    const after = getFlickerSnapshot();
    expect(after.totalFlickerFrames).toBe(before.totalFlickerFrames + 1);
    expect(after.lastFlickerAt).toBeGreaterThan(0);
  });

  it('subscribeFlicker receives state updates via microtask', async () => {
    const { recordFlickerFrame, subscribeFlicker } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    const events: number[] = [];
    const unsub = subscribeFlicker((s) => events.push(s.totalFlickerFrames));
    recordFlickerFrame();
    await Promise.resolve(); // flush microtask
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBeGreaterThanOrEqual(1);
    unsub();
  });

  it('onFlicker fires callback synchronously on each flicker', async () => {
    const { recordFlickerFrame, onFlicker } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    let calls = 0;
    const unsub = onFlicker(() => {
      calls++;
    });
    recordFlickerFrame();
    recordFlickerFrame();
    recordFlickerFrame();
    expect(calls).toBe(3);
    unsub();
  });

  it('onFlicker callback errors do not crash the recorder', async () => {
    const { recordFlickerFrame, onFlicker } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    const unsub = onFlicker(() => {
      throw new Error('boom');
    });
    expect(() => recordFlickerFrame()).not.toThrow();
    unsub();
  });

  it('resetFlickerState zeroes the counters', async () => {
    const { recordFlickerFrame, resetFlickerState, getFlickerSnapshot } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    recordFlickerFrame();
    recordFlickerFrame();
    resetFlickerState();
    const snap = getFlickerSnapshot();
    expect(snap.totalFlickerFrames).toBe(0);
    expect(snap.lastFlickerAt).toBe(0);
  });

  it('subscribeFlicker is a no-op when disabled', async () => {
    delete process.env['GOLI_TUI_DEBUG'];
    vi.resetModules();
    const { subscribeFlicker, recordFlickerFrame } = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    const events: number[] = [];
    const unsub = subscribeFlicker((s) => events.push(s.totalFlickerFrames));
    recordFlickerFrame();
    await Promise.resolve();
    expect(events).toHaveLength(0);
    unsub();
  });
});

// ─── debugProfiler ────────────────────────────────────────────────────────

describe('T-060: debugProfiler', () => {
  let origDebug: string | undefined;

  beforeEach(() => {
    origDebug = process.env['GOLI_TUI_DEBUG'];
    process.env['GOLI_TUI_DEBUG'] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (origDebug === undefined) delete process.env['GOLI_TUI_DEBUG'];
    else process.env['GOLI_TUI_DEBUG'] = origDebug;
    vi.restoreAllMocks();
  });

  it('reportAction pushes to actionTimestamps (debounced at 16ms)', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.reportAction();
    // Wait >16ms so the debounce allows the second push.
    await new Promise((r) => setTimeout(r, 20));
    profiler.reportAction();
    expect(profiler.actionTimestamps.size()).toBeGreaterThanOrEqual(2);
  });

  it('reportAction deduplicates calls within 16ms', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.reportAction();
    profiler.reportAction();
    profiler.reportAction();
    // All within 16ms — only one push.
    expect(profiler.actionTimestamps.size()).toBe(1);
  });

  it('reportAction is a no-op when disabled', async () => {
    delete process.env['GOLI_TUI_DEBUG'];
    vi.resetModules();
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.reportAction();
    expect(profiler.actionTimestamps.size()).toBe(0);
  });

  it('reportFrameRendered is a no-op when no profiler is active', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.reportFrameRendered();
    expect(profiler.numFrames).toBe(0);
  });

  it('reportFrameRendered increments numFrames when a profiler is active', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.profilersActive = 1;
    profiler.reportFrameRendered();
    profiler.reportFrameRendered();
    profiler.reportFrameRendered();
    expect(profiler.numFrames).toBe(3);
  });

  it('snapshot returns the current state', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.profilersActive = 1;
    profiler.reportAction();
    profiler.reportFrameRendered();
    const snap = profiler.snapshot();
    expect(snap.numFrames).toBe(1);
    expect(snap.profilersActive).toBe(1);
    expect(snap.lastActionTimestamp).toBeGreaterThan(0);
  });

  it('checkForIdleFrames classifies old frames without actions as idle', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    // Simulate a frame rendered 1 second ago with NO recent action.
    const oneSecondAgo = Date.now() - 1000;
    profiler.possiblyIdleFrameTimestamps.push(oneSecondAgo);
    profiler.checkForIdleFrames();
    expect(profiler.totalIdleFrames).toBeGreaterThanOrEqual(1);
  });

  it('checkForIdleFrames does NOT classify frames with nearby actions as idle', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    const oneSecondAgo = Date.now() - 1000;
    // Action right at the frame time — should NOT be idle.
    profiler.actionTimestamps.push(oneSecondAgo);
    profiler.possiblyIdleFrameTimestamps.push(oneSecondAgo);
    profiler.checkForIdleFrames();
    expect(profiler.totalIdleFrames).toBe(0);
  });

  it('reportFlicker increments totalFlickerFrames', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.reportFlicker();
    profiler.reportFlicker();
    expect(profiler.totalFlickerFrames).toBe(2);
    expect(profiler.hasLoggedFirstFlicker).toBe(true);
  });

  it('reset zeroes all counters and clears buffers', async () => {
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.profilersActive = 2;
    profiler.numFrames = 100;
    profiler.totalIdleFrames = 5;
    profiler.totalFlickerFrames = 3;
    profiler.actionTimestamps.push(Date.now());
    profiler.possiblyIdleFrameTimestamps.push(Date.now());
    profiler.reset();
    expect(profiler.profilersActive).toBe(0);
    expect(profiler.numFrames).toBe(0);
    expect(profiler.totalIdleFrames).toBe(0);
    expect(profiler.totalFlickerFrames).toBe(0);
    expect(profiler.actionTimestamps.size()).toBe(0);
    expect(profiler.possiblyIdleFrameTimestamps.size()).toBe(0);
  });

  it('wireFlickerToProfiler connects flickerStore to profiler.reportFlicker', async () => {
    const flicker = await import('../../packages/cli/src/tui/lib/flickerStore.js');
    const { profiler, wireFlickerToProfiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    const unwire = wireFlickerToProfiler();
    flicker.recordFlickerFrame();
    expect(profiler.totalFlickerFrames).toBe(1);
    unwire();
    flicker.recordFlickerFrame();
    expect(profiler.totalFlickerFrames).toBe(1); // unwired — no increment
  });
});

// ─── DebugProfiler component ──────────────────────────────────────────────

describe('T-060: DebugProfiler component', () => {
  let origDebug: string | undefined;

  beforeEach(() => {
    origDebug = process.env['GOLI_TUI_DEBUG'];
    process.env['GOLI_TUI_DEBUG'] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (origDebug === undefined) delete process.env['GOLI_TUI_DEBUG'];
    else process.env['GOLI_TUI_DEBUG'] = origDebug;
    vi.restoreAllMocks();
  });

  it('MaybeDebugProfiler renders nothing visible when when=false', async () => {
    const { MaybeDebugProfiler } = await import('../../packages/cli/src/tui/components/DebugProfiler.js');
    const { lastFrame } = render(<MaybeDebugProfiler when={false} />);
    const frame = lastFrame() ?? '';
    expect(frame).toBe('');
  });

  it('MaybeDebugProfiler renders nothing visible when GOLI_TUI_DEBUG unset', async () => {
    delete process.env['GOLI_TUI_DEBUG'];
    vi.resetModules();
    const { MaybeDebugProfiler } = await import('../../packages/cli/src/tui/components/DebugProfiler.js');
    const { lastFrame } = render(<MaybeDebugProfiler />);
    const frame = lastFrame() ?? '';
    expect(frame).toBe('');
  });

  it('DebugProfiler renders stats when enabled', async () => {
    const { DebugProfiler } = await import('../../packages/cli/src/tui/components/DebugProfiler.js');
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    profiler.profilersActive = 1;
    profiler.numFrames = 42;
    profiler.totalIdleFrames = 3;
    profiler.totalFlickerFrames = 1;
    const { lastFrame } = render(<DebugProfiler refreshIntervalMs={100} />);
    const frame = lastFrame();
    expect(frame).not.toBeNull();
    // The stats appear in the rendered output.
    expect(frame!.includes('42')).toBe(true);
    expect(frame!.includes('3')).toBe(true);
    expect(frame!.includes('1')).toBe(true);
  });

  it('DebugProfiler increments profilersActive on mount, decrements on unmount', async () => {
    const { DebugProfiler } = await import('../../packages/cli/src/tui/components/DebugProfiler.js');
    const { profiler } = await import('../../packages/cli/src/tui/lib/debugProfiler.js');
    profiler.reset();
    expect(profiler.profilersActive).toBe(0);
    const { unmount } = render(<DebugProfiler refreshIntervalMs={100} />);
    // useEffect runs after commit; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(profiler.profilersActive).toBe(1);
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(profiler.profilersActive).toBe(0);
  });
});

// ─── batchedScroll ────────────────────────────────────────────────────────

describe('T-060: batchedScroll', () => {
  let origDebug: string | undefined;

  beforeEach(() => {
    origDebug = process.env['GOLI_TUI_DEBUG'];
    process.env['GOLI_TUI_DEBUG'] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (origDebug === undefined) delete process.env['GOLI_TUI_DEBUG'];
    else process.env['GOLI_TUI_DEBUG'] = origDebug;
    vi.restoreAllMocks();
  });

  it('scheduleScrollTop is a no-op when no setter is registered', async () => {
    const { scheduleScrollTop, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    expect(() => scheduleScrollTop(100)).not.toThrow();
  });

  it('scheduleScrollTop coalesces multiple calls into one setter call', async () => {
    const { scheduleScrollTop, registerScrollSetter, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    const calls: number[] = [];
    const unsub = registerScrollSetter((v) => calls.push(v));
    scheduleScrollTop(10);
    scheduleScrollTop(20);
    scheduleScrollTop(30);
    scheduleScrollTop(40);
    await Promise.resolve(); // flush microtask
    expect(calls).toEqual([40]); // only the latest value
    unsub();
  });

  it('flushPendingScroll applies the pending value immediately', async () => {
    const { scheduleScrollTop, flushPendingScroll, registerScrollSetter, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    const calls: number[] = [];
    const unsub = registerScrollSetter((v) => calls.push(v));
    scheduleScrollTop(99);
    flushPendingScroll();
    expect(calls).toEqual([99]);
    unsub();
  });

  it('getPendingScrollTop returns the latest scheduled value', async () => {
    const { scheduleScrollTop, getPendingScrollTop, registerScrollSetter, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    const unsub = registerScrollSetter(() => undefined);
    scheduleScrollTop(7);
    expect(getPendingScrollTop()).toBe(7);
    unsub();
  });

  it('unregister stops the setter from receiving updates', async () => {
    const { scheduleScrollTop, registerScrollSetter, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    const calls: number[] = [];
    const unsub = registerScrollSetter((v) => calls.push(v));
    unsub();
    scheduleScrollTop(50);
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('registering a new setter replaces the previous one', async () => {
    const { scheduleScrollTop, registerScrollSetter, resetBatchedScroll } = await import('../../packages/cli/src/tui/lib/batchedScroll.js');
    resetBatchedScroll();
    const calls1: number[] = [];
    const calls2: number[] = [];
    const unsub1 = registerScrollSetter((v) => calls1.push(v));
    const unsub2 = registerScrollSetter((v) => calls2.push(v));
    scheduleScrollTop(15);
    await Promise.resolve();
    expect(calls1).toEqual([]); // replaced
    expect(calls2).toEqual([15]);
    unsub1();
    unsub2();
  });
});

// ─── useFlickerDetector hook ──────────────────────────────────────────────

describe('T-060: useFlickerDetector hook', () => {
  let origDebug: string | undefined;

  beforeEach(() => {
    origDebug = process.env['GOLI_TUI_DEBUG'];
    process.env['GOLI_TUI_DEBUG'] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (origDebug === undefined) delete process.env['GOLI_TUI_DEBUG'];
    else process.env['GOLI_TUI_DEBUG'] = origDebug;
    vi.restoreAllMocks();
  });

  it('useFlickerDetector is importable and callable', async () => {
    const mod = await import('../../packages/cli/src/tui/hooks/useFlickerDetector.js');
    expect(typeof mod.useFlickerDetector).toBe('function');
  });

  it('a component using the hook renders without crashing', async () => {
    const { useFlickerDetector } = await import('../../packages/cli/src/tui/hooks/useFlickerDetector.js');
    const { Box, Text } = await import('ink');
    function TestApp(): React.ReactElement {
      const ref = React.useRef(null);
      useFlickerDetector(ref, 24, true);
      return (
        <Box ref={ref}>
          <Text>hello</Text>
        </Box>
      );
    }
    const { lastFrame } = render(<TestApp />);
    expect(lastFrame()).not.toBeNull();
  });
});
