/**
 * Unit tests for the stall detector.
 */

import { describe, it, expect } from 'vitest';

import { StallDetector } from '../../packages/core/src/agent/stall-detector.js';
import { DEFAULT_CONFIG } from '../../packages/core/src/config/schema.js';

import type { ToolCall } from '../../packages/core/src/agent/types.js';

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
