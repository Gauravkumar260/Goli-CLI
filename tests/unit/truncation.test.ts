/**
 * Unit tests for the result truncation.
 */

import { describe, it, expect } from 'vitest';

import { truncateResult, MAX_TOOL_RESULT_TOKENS } from '../../packages/core/src/tools/truncation.js';

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
});
