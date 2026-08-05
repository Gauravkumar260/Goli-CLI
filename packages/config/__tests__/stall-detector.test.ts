/**
 * Unit tests for the stall detector.
 */

import { describe, it, expect } from 'vitest';

import { StallDetector } from '@goli-cli/agent-core/stall-detector.js';
import { DEFAULT_CONFIG } from '../src/schema.js';

import type { ToolCall } from '@goli-cli/agent-core/types.js';

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

describe('StallDetector', () => {
  it('does not detect stall with diverse tool calls', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    expect(detector.recordAndCheck(makeToolCall('read_file', { path: 'a.ts' }))).toBe(false);
    expect(detector.recordAndCheck(makeToolCall('read_file', { path: 'b.ts' }))).toBe(false);
    expect(detector.recordAndCheck(makeToolCall('grep', { pattern: 'foo' }))).toBe(false);
  });

  it('detects 3 identical tool calls in a row', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const tc = makeToolCall('read_file', { path: 'same.ts' });
    expect(detector.recordAndCheck(tc)).toBe(false);
    expect(detector.recordAndCheck(tc)).toBe(false);
    expect(detector.recordAndCheck(tc)).toBe(true); // 3rd identical → stall
  });

  it('resets stall counter after a different call', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const tc1 = makeToolCall('read_file', { path: 'a.ts' });
    const tc2 = makeToolCall('read_file', { path: 'b.ts' });
    detector.recordAndCheck(tc1);
    detector.recordAndCheck(tc1);
    // Different call breaks the streak
    expect(detector.recordAndCheck(tc2)).toBe(false);
    // Two more of tc1 shouldn't stall (window shifted)
    expect(detector.recordAndCheck(tc1)).toBe(false);
    expect(detector.recordAndCheck(tc1)).toBe(false);
  });

  it('treats different argument order as identical (sorted keys)', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const tc1 = makeToolCall('edit_file', { old: 'a', new: 'b' });
    const tc2 = makeToolCall('edit_file', { new: 'b', old: 'a' });
    detector.recordAndCheck(tc1);
    detector.recordAndCheck(tc2);
    expect(detector.recordAndCheck(tc1)).toBe(true); // 3rd "identical" → stall
  });

  it('reset() clears the signature window', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const tc = makeToolCall('read_file', { path: 'same.ts' });
    detector.recordAndCheck(tc);
    detector.recordAndCheck(tc);
    detector.reset();
    expect(detector.getSignatures()).toHaveLength(0);
    expect(detector.recordAndCheck(tc)).toBe(false);
  });

  it('does not stall below threshold', () => {
    const config = { ...DEFAULT_CONFIG.stall, identicalCallThreshold: 5 };
    const detector = new StallDetector(config);
    const tc = makeToolCall('read_file', { path: 'same.ts' });
    for (let i = 0; i < 4; i++) {
      expect(detector.recordAndCheck(tc)).toBe(false);
    }
    expect(detector.recordAndCheck(tc)).toBe(true); // 5th → stall
  });
});

// ─── Characterization tests for deferred flaws ────────────────────────────
// These tests lock CURRENT behavior for flaws flagged as BEHAVIOR-CHANGING
// and deferred for human approval. When a proposal is approved and applied,
// update the corresponding test to assert the new behavior.
describe('StallDetector — flaw characterization (pending human approval)', () => {
  // Flaw 2: null argumentsParsed is treated as parse failure (RAW path)
  // because `!null` is true. A pending fix would use `=== undefined` instead.
  it('flaw 2: null argumentsParsed takes RAW path (CURRENT behavior)', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const tcNull: ToolCall = {
      id: 'tc-null',
      name: 'x',
      arguments: 'null',
      argumentsParsed: null as unknown as undefined, // simulate parsed null
      status: 'pending',
    };
    detector.recordAndCheck(tcNull);
    detector.recordAndCheck(tcNull);
    const sigs = detector.getSignatures();
    // CURRENT: signature is `x:RAW:null` (RAW path because !null === true).
    expect(sigs[0]).toBe('x:RAW:null');
    // After fix: would be `x:null` (sorted-JSON path).
  });

  // Flaw 3: circular argumentsParsed USED TO crash the detector.
  // The crash happened in sortObjectKeys (called before JSON.stringify) via
  // infinite recursion → RangeError: Maximum call stack size exceeded.
  // FIX APPLIED: sortObjectKeys now uses a WeakSet to detect cycles and
  // returns '[Circular]' instead of recursing infinitely. The signature
  // computation no longer throws, and the first call returns false (below
  // the stall threshold).
  it('flaw 3: circular argumentsParsed no longer throws (FIX APPLIED)', () => {
    const detector = new StallDetector(DEFAULT_CONFIG.stall);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const tcCircular: ToolCall = {
      id: 'tc-circular',
      name: 'x',
      arguments: '{}',
      argumentsParsed: circular,
      status: 'pending',
    };
    // Fixed behavior: no throw, returns false (1st call, below threshold).
    expect(detector.recordAndCheck(tcCircular)).toBe(false);
  });

  // Flaw 7: windowSize < threshold silently never fires.
  // A pending fix would add a console.warn at construction.
  it('flaw 7: windowSize < threshold never fires (CURRENT behavior, no warning)', () => {
    const config = { identicalCallThreshold: 5, windowSize: 2 };
    const detector = new StallDetector(config);
    const tc = makeToolCall('read_file', { path: 'same.ts' });
    // 10 identical calls — but windowSize=2 caps the array at 2, threshold=5
    // means length(2) < 5 → always false.
    for (let i = 0; i < 10; i++) {
      expect(detector.recordAndCheck(tc)).toBe(false);
    }
    // After fix: construction would emit console.warn.
  });
});
