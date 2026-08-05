/**
 * Unit tests for the blast radius enforcer.
 */

import { describe, it, expect } from 'vitest';

import {
  computeBlastRadius,
  DEFAULT_BLAST_RADIUS_CONFIG,
} from '../src/blast-radius.js';

describe('computeBlastRadius', () => {
  it('allows small additions', () => {
    const old = 'line1\nline2\nline3\nline4\nline5\n';
    const next = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n';
    const result = computeBlastRadius(old, next);
    expect(result.allowed).toBe(true);
    expect(result.deletedLines).toBe(0);
  });

  it('allows small deletions under threshold', () => {
    const old = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const next = old.replace('line 50\n', ''); // delete 1 of 100 = 1%
    const result = computeBlastRadius(old, next);
    expect(result.allowed).toBe(true);
    expect(result.deletedLines).toBe(1);
    expect(result.deletionRatio).toBeCloseTo(0.01, 2);
  });

  it('blocks deletions exceeding ratio threshold', () => {
    const old = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    // Delete 30 lines = 30% > 20% threshold
    const next = Array.from({ length: 70 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const result = computeBlastRadius(old, next);
    expect(result.allowed).toBe(false);
    expect(result.deletionRatio).toBeGreaterThan(0.20);
    expect(result.reason).toContain('Blast radius exceeded');
  });

  it('blocks deletions exceeding absolute cap', () => {
    const old = Array.from({ length: 10000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    // Delete 600 lines = 6% (under ratio) but > 500 absolute cap
    const next = Array.from({ length: 9400 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const result = computeBlastRadius(old, next);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max 500');
  });

  it('does not enforce on tiny files', () => {
    const old = 'a\nb\nc\n';
    const next = ''; // delete everything
    const result = computeBlastRadius(old, next, {
      maxDeletionRatio: 0.2,
      minLinesToEnforce: 10,
      maxAbsoluteDeletion: 500,
    });
    expect(result.allowed).toBe(true); // too small to enforce
  });

  it('respects custom config', () => {
    const old = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const next = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    // 50% deletion — blocked at 20% but allowed at 60%
    const strictResult = computeBlastRadius(old, next, { ...DEFAULT_BLAST_RADIUS_CONFIG, maxDeletionRatio: 0.2 });
    const lenientResult = computeBlastRadius(old, next, { ...DEFAULT_BLAST_RADIUS_CONFIG, maxDeletionRatio: 0.6 });
    expect(strictResult.allowed).toBe(false);
    expect(lenientResult.allowed).toBe(true);
  });

  it('handles identical content', () => {
    const content = 'line1\nline2\nline3\n';
    const result = computeBlastRadius(content, content);
    expect(result.allowed).toBe(true);
    expect(result.deletedLines).toBe(0);
  });

  it('handles empty old content', () => {
    const result = computeBlastRadius('', 'new content\n');
    expect(result.allowed).toBe(true);
    expect(result.deletedLines).toBe(0);
  });
});
