/**
 * Unit tests for the result truncation.
 */

import { describe, it, expect } from 'vitest';

import { truncateResult, MAX_TOOL_RESULT_TOKENS } from '../src/truncation.js';

describe('truncateResult', () => {
  it('returns content as-is when under the cap', () => {
    const content = 'Hello, world!';
    const result = truncateResult(content);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it('truncates content when over the cap', () => {
    const content = 'x'.repeat(MAX_TOOL_RESULT_TOKENS * 4 + 1000);
    const result = truncateResult(content);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[... truncated ...]');
    expect(result.totalTokens).toBeGreaterThan(MAX_TOOL_RESULT_TOKENS);
  });

  it('includes a hint when truncated', () => {
    const content = 'x'.repeat(MAX_TOOL_RESULT_TOKENS * 4 + 100);
    const result = truncateResult(content);
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('truncated');
  });

  it('respects a custom maxTokens', () => {
    const content = 'x'.repeat(1000);
    const result = truncateResult(content, 100); // 100 tokens = 400 chars
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(content.length);
  });

  it('uses custom hint when provided', () => {
    const content = 'x'.repeat(MAX_TOOL_RESULT_TOKENS * 4 + 100);
    const customHint = 'Use offset=100 to get more';
    const result = truncateResult(content, MAX_TOOL_RESULT_TOKENS, customHint);
    expect(result.hint).toBe(customHint);
    // The hint is not in the content — the registry appends it separately
    expect(result.content).toContain('[... truncated ...]');
  });

  it('estimates total tokens from char count', () => {
    const content = 'a'.repeat(4000); // 4000 chars = ~1000 tokens
    const result = truncateResult(content, 5000);
    expect(result.totalTokens).toBe(1000);
  });

  // ─── Characterization: flaw 7 (head vs tail retention) ───────────────────
  // These tests lock the CURRENT behavior: truncateResult keeps the HEAD
  // (first maxChars) of the content, NOT the tail. The original module JSDoc
  // said "keep newest" (tail), but the implementation has always kept the
  // head. A pending BEHAVIOR-CHANGING proposal would switch to tail-keeping
  // to match the original spec intent. When that proposal is human-approved,
  // these assertions must be updated to expect the tail portion.
  describe('flaw 7 — head retention (CURRENT behavior, pending human approval)', () => {
    it('keeps the HEAD of the content (first maxChars), not the tail', () => {
      // 10000 chars = 2500 tokens; with maxTokens=100 (400 chars), truncation triggers.
      const head = 'HEAD'.repeat(100); // 400 chars, at the start
      const middle = 'M'.repeat(9000); // 9000 chars, in the middle
      const tail = 'TAIL'.repeat(100); // 400 chars, at the end
      const content = head + middle + tail; // 9800 chars total
      const result = truncateResult(content, 100); // 100 tokens = 400 chars
      expect(result.truncated).toBe(true);
      // CURRENT: keeps first 400 chars = the HEAD portion.
      expect(result.content.startsWith('HEAD')).toBe(true);
      // CURRENT: does NOT keep the TAIL portion.
      expect(result.content).not.toContain('TAIL');
    });

    it('hint message says "showing first" (consistent with head retention)', () => {
      const content = 'x'.repeat(1000);
      const result = truncateResult(content, 10); // 10 tokens = 40 chars
      expect(result.truncated).toBe(true);
      expect(result.hint).toContain('showing first');
      expect(result.hint).not.toContain('showing last');
    });
  });

  it('returns content as-is when exactly at the cap (boundary)', () => {
    // 400 chars = 100 tokens; with maxTokens=100, totalTokens === maxTokens → not truncated.
    const content = 'a'.repeat(400);
    const result = truncateResult(content, 100);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it('handles empty string without truncation', () => {
    const result = truncateResult('', 100);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe('');
    expect(result.totalTokens).toBe(0);
  });
});
