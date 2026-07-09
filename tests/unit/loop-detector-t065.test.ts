/**
 * Tests for the Loop Detector (T-065 / closes T-031).
 *
 * Covers:
 *   - LoopDetector.recordToolCall: detects N consecutive identical calls
 *   - LoopDetector.recordToolCall: resets on different call
 *   - LoopDetector.recordToolCall: below threshold = no loop
 *   - LoopDetector.recordContent: detects N consecutive identical contents
 *   - LoopDetector.recordContent: resets on different content
 *   - LoopDetector.reset: clears state
 *   - LoopDetector.onLoopDetected callback fires
 *   - detectToolCallLoop / detectContentLoop standalone functions
 *   - Thresholds are configurable
 *   - Hashing is deterministic (same args → same hash)
 *   - Different args produce different hashes (no false positive)
 */

import { describe, it, expect, vi } from 'vitest';

import {
  LoopDetector,
  detectToolCallLoop,
  detectContentLoop,
  TOOL_CALL_LOOP_THRESHOLD,
  CONTENT_LOOP_THRESHOLD,
  type ToolCallRecord,
  type LoopDetectedEvent,
} from '../../packages/core/src/agent/loop-detector.js';

// ─── LoopDetector.recordToolCall ──────────────────────────────────────────

describe('T-065: LoopDetector.recordToolCall', () => {
  it('does not detect a loop below the threshold', () => {
    const detector = new LoopDetector({ toolCallThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      const loop = detector.recordToolCall({ name: 'read_file', args: { path: 'foo.ts' } });
      expect(loop).toBeNull();
    }
  });

  it('detects a loop at the threshold', () => {
    const detector = new LoopDetector({ toolCallThreshold: 5 });
    let loop = null;
    for (let i = 0; i < 5; i++) {
      loop = detector.recordToolCall({ name: 'read_file', args: { path: 'foo.ts' } });
    }
    expect(loop).not.toBeNull();
    expect(loop!.code).toBe('LoopDetected');
    expect(loop!.event.type).toBe('tool_call');
    expect(loop!.event.count).toBe(5);
    expect(loop!.event.threshold).toBe(5);
    expect(loop!.event.description).toContain('read_file');
  });

  it('detects a loop above the threshold', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    let loop = null;
    for (let i = 0; i < 7; i++) {
      loop = detector.recordToolCall({ name: 'bash', args: { command: 'npm test' } });
    }
    expect(loop).not.toBeNull();
    expect(loop!.event.count).toBe(7);
  });

  it('resets the counter when a different tool call is recorded', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    // 2 identical calls.
    detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    // Different call — should reset.
    detector.recordToolCall({ name: 'write_file', args: { path: 'b.ts' } });
    // 1 more identical to the first — should NOT loop (counter reset to 1).
    const loop = detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    expect(loop).toBeNull();
  });

  it('resets the counter when the same tool is called with different args', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    // Same tool, different args.
    detector.recordToolCall({ name: 'read_file', args: { path: 'b.ts' } });
    // 1 more with the original args — counter should be 1, not 3.
    const loop = detector.recordToolCall({ name: 'read_file', args: { path: 'a.ts' } });
    expect(loop).toBeNull();
  });

  it('uses the default threshold of 5 when not specified', () => {
    const detector = new LoopDetector();
    let loop = null;
    for (let i = 0; i < TOOL_CALL_LOOP_THRESHOLD - 1; i++) {
      loop = detector.recordToolCall({ name: 'grep', args: { pattern: 'foo' } });
    }
    expect(loop).toBeNull();
    loop = detector.recordToolCall({ name: 'grep', args: { pattern: 'foo' } });
    expect(loop).not.toBeNull();
  });

  it('the loop event includes a description with tool name + args', () => {
    const detector = new LoopDetector({ toolCallThreshold: 2 });
    let loop = null;
    loop = detector.recordToolCall({ name: 'bash', args: { command: 'echo hello' } });
    loop = detector.recordToolCall({ name: 'bash', args: { command: 'echo hello' } });
    expect(loop).not.toBeNull();
    expect(loop!.event.description).toContain('bash');
    expect(loop!.event.description).toContain('echo hello');
  });

  it('the loop event includes a timestamp', () => {
    const detector = new LoopDetector({ toolCallThreshold: 2 });
    const before = Date.now();
    detector.recordToolCall({ name: 'x', args: {} });
    const loop = detector.recordToolCall({ name: 'x', args: {} });
    const after = Date.now();
    expect(loop).not.toBeNull();
    expect(loop!.event.timestamp).toBeGreaterThanOrEqual(before);
    expect(loop!.event.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── LoopDetector.recordContent ───────────────────────────────────────────

describe('T-065: LoopDetector.recordContent', () => {
  it('does not detect a loop below the threshold', () => {
    const detector = new LoopDetector({ contentThreshold: 10 });
    for (let i = 0; i < 9; i++) {
      const loop = detector.recordContent('same content');
      expect(loop).toBeNull();
    }
  });

  it('detects a loop at the threshold', () => {
    const detector = new LoopDetector({ contentThreshold: 3 });
    let loop = null;
    for (let i = 0; i < 3; i++) {
      loop = detector.recordContent('same content');
    }
    expect(loop).not.toBeNull();
    expect(loop!.event.type).toBe('content');
    expect(loop!.event.count).toBe(3);
  });

  it('resets the counter when different content is recorded', () => {
    const detector = new LoopDetector({ contentThreshold: 3 });
    detector.recordContent('a');
    detector.recordContent('a');
    detector.recordContent('b'); // different — resets
    const loop = detector.recordContent('a'); // counter = 1
    expect(loop).toBeNull();
  });

  it('uses the default threshold of 10 when not specified', () => {
    const detector = new LoopDetector();
    let loop = null;
    for (let i = 0; i < CONTENT_LOOP_THRESHOLD - 1; i++) {
      loop = detector.recordContent('x');
    }
    expect(loop).toBeNull();
    loop = detector.recordContent('x');
    expect(loop).not.toBeNull();
  });

  it('the loop event includes a content hash description', () => {
    const detector = new LoopDetector({ contentThreshold: 2 });
    detector.recordContent('hello');
    const loop = detector.recordContent('hello');
    expect(loop).not.toBeNull();
    expect(loop!.event.description).toContain('hash=');
  });
});

// ─── LoopDetector.reset ───────────────────────────────────────────────────

describe('T-065: LoopDetector.reset', () => {
  it('clears the tool-call counter', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    detector.recordToolCall({ name: 'x', args: {} });
    detector.recordToolCall({ name: 'x', args: {} });
    expect(detector.getConsecutiveToolCallCount()).toBe(2);
    detector.reset();
    expect(detector.getConsecutiveToolCallCount()).toBe(0);
  });

  it('clears the content counter', () => {
    const detector = new LoopDetector({ contentThreshold: 3 });
    detector.recordContent('a');
    detector.recordContent('a');
    expect(detector.getConsecutiveContentCount()).toBe(2);
    detector.reset();
    expect(detector.getConsecutiveContentCount()).toBe(0);
  });

  it('after reset, a new sequence starts fresh', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    detector.recordToolCall({ name: 'x', args: {} });
    detector.recordToolCall({ name: 'x', args: {} });
    detector.reset();
    // After reset, 2 more calls should NOT loop (counter = 2, threshold = 3).
    detector.recordToolCall({ name: 'x', args: {} });
    const loop = detector.recordToolCall({ name: 'x', args: {} });
    expect(loop).toBeNull();
  });
});

// ─── onLoopDetected callback ──────────────────────────────────────────────

describe('T-065: LoopDetector.onLoopDetected callback', () => {
  it('fires the callback when a tool-call loop is detected', () => {
    const cb = vi.fn();
    const detector = new LoopDetector({ toolCallThreshold: 2, onLoopDetected: cb });
    detector.recordToolCall({ name: 'x', args: {} });
    detector.recordToolCall({ name: 'x', args: {} });
    expect(cb).toHaveBeenCalledTimes(1);
    const event: LoopDetectedEvent = cb.mock.calls[0]![0];
    expect(event.type).toBe('tool_call');
    expect(event.count).toBe(2);
  });

  it('fires the callback when a content loop is detected', () => {
    const cb = vi.fn();
    const detector = new LoopDetector({ contentThreshold: 2, onLoopDetected: cb });
    detector.recordContent('a');
    detector.recordContent('a');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].type).toBe('content');
  });

  it('does NOT fire the callback below the threshold', () => {
    const cb = vi.fn();
    const detector = new LoopDetector({ toolCallThreshold: 5, onLoopDetected: cb });
    detector.recordToolCall({ name: 'x', args: {} });
    detector.recordToolCall({ name: 'x', args: {} });
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─── detectToolCallLoop / detectContentLoop standalone ─────────────────────

describe('T-065: detectToolCallLoop standalone', () => {
  it('returns a loop error when the sequence contains a loop', () => {
    const calls: ToolCallRecord[] = Array(5).fill({ name: 'read_file', args: { path: 'x.ts' } });
    const loop = detectToolCallLoop(calls, 5);
    expect(loop).not.toBeNull();
    expect(loop!.event.type).toBe('tool_call');
    expect(loop!.event.count).toBe(5);
  });

  it('returns null when the sequence does not contain a loop', () => {
    const calls: ToolCallRecord[] = [
      { name: 'a', args: {} },
      { name: 'b', args: {} },
      { name: 'c', args: {} },
    ];
    const loop = detectToolCallLoop(calls, 5);
    expect(loop).toBeNull();
  });

  it('returns null for an empty sequence', () => {
    const loop = detectToolCallLoop([], 5);
    expect(loop).toBeNull();
  });

  it('uses the default threshold of 5', () => {
    const calls: ToolCallRecord[] = Array(4).fill({ name: 'x', args: {} });
    expect(detectToolCallLoop(calls)).toBeNull();
    const calls5: ToolCallRecord[] = Array(5).fill({ name: 'x', args: {} });
    expect(detectToolCallLoop(calls5)).not.toBeNull();
  });
});

describe('T-065: detectContentLoop standalone', () => {
  it('returns a loop error when the sequence contains a loop', () => {
    const contents = Array(10).fill('same');
    const loop = detectContentLoop(contents, 10);
    expect(loop).not.toBeNull();
    expect(loop!.event.type).toBe('content');
  });

  it('returns null when the sequence does not contain a loop', () => {
    const contents = ['a', 'b', 'c', 'a', 'b', 'c'];
    const loop = detectContentLoop(contents, 10);
    expect(loop).toBeNull();
  });

  it('uses the default threshold of 10', () => {
    const contents9 = Array(9).fill('x');
    expect(detectContentLoop(contents9)).toBeNull();
    const contents10 = Array(10).fill('x');
    expect(detectContentLoop(contents10)).not.toBeNull();
  });
});

// ─── Hashing determinism ──────────────────────────────────────────────────

describe('T-065: hashing determinism', () => {
  it('same tool call produces the same internal state', () => {
    const d1 = new LoopDetector({ toolCallThreshold: 2 });
    const d2 = new LoopDetector({ toolCallThreshold: 2 });
    d1.recordToolCall({ name: 'x', args: { a: 1 } });
    d2.recordToolCall({ name: 'x', args: { a: 1 } });
    expect(d1.getConsecutiveToolCallCount()).toBe(d2.getConsecutiveToolCallCount());
  });

  it('different args produce different hashes (no false positive)', () => {
    const detector = new LoopDetector({ toolCallThreshold: 3 });
    // 2 calls with arg=1, then 2 calls with arg=2, then 2 calls with arg=1.
    // No 3 consecutive identical — should not loop.
    detector.recordToolCall({ name: 'x', args: { n: 1 } });
    detector.recordToolCall({ name: 'x', args: { n: 1 } });
    detector.recordToolCall({ name: 'x', args: { n: 2 } });
    detector.recordToolCall({ name: 'x', args: { n: 2 } });
    const loop = detector.recordToolCall({ name: 'x', args: { n: 1 } });
    expect(loop).toBeNull();
  });

  it('null args and undefined args are treated equivalently', () => {
    const detector = new LoopDetector({ toolCallThreshold: 2 });
    detector.recordToolCall({ name: 'x', args: null });
    // null and undefined both serialize to the same JSON? No —
    // JSON.stringify(null) = 'null', JSON.stringify(undefined) = undefined.
    // Our hashToolCall uses `call.args ?? {}`, so null → {}, undefined → {}.
    // So both should hash the same.
    const loop = detector.recordToolCall({ name: 'x', args: undefined });
    expect(loop).not.toBeNull();
  });
});

// ─── Configurable thresholds ──────────────────────────────────────────────

describe('T-065: configurable thresholds', () => {
  it('toolCallThreshold=1 fires on the first call', () => {
    const detector = new LoopDetector({ toolCallThreshold: 1 });
    const loop = detector.recordToolCall({ name: 'x', args: {} });
    expect(loop).not.toBeNull();
    expect(loop!.event.count).toBe(1);
  });

  it('contentThreshold=1 fires on the first content', () => {
    const detector = new LoopDetector({ contentThreshold: 1 });
    const loop = detector.recordContent('anything');
    expect(loop).not.toBeNull();
  });

  it('high thresholds require more repetitions', () => {
    const detector = new LoopDetector({ toolCallThreshold: 100 });
    for (let i = 0; i < 99; i++) {
      const loop = detector.recordToolCall({ name: 'x', args: {} });
      expect(loop).toBeNull();
    }
    const loop = detector.recordToolCall({ name: 'x', args: {} });
    expect(loop).not.toBeNull();
    expect(loop!.event.count).toBe(100);
  });
});
