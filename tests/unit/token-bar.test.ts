/**
 * Unit tests for the TokenBar utility functions (reference design).
 */

import { describe, it, expect } from 'vitest';

import {
  tokPct,
  tokBar,
  formatTokenLimit,
  tokColor,
} from '../../packages/cli/src/tui/components/TokenBar.js';

describe('TokenBar utilities', () => {
  describe('tokPct', () => {
    it('computes percentage correctly', () => {
      expect(tokPct(500, 1000)).toBe(50);
      expect(tokPct(250, 1000)).toBe(25);
      expect(tokPct(0, 1000)).toBe(0);
    });

    it('caps at 100', () => {
      expect(tokPct(1500, 1000)).toBe(100);
    });
  });

  describe('tokBar', () => {
    it('renders the bar string at width 10', () => {
      expect(tokBar(0)).toBe('░░░░░░░░░░');
      expect(tokBar(50)).toBe('█████░░░░░');
      expect(tokBar(100)).toBe('██████████');
    });
  });

  describe('formatTokenLimit', () => {
    it('formats large numbers as K', () => {
      expect(formatTokenLimit(1000)).toBe('1K');
      expect(formatTokenLimit(200000)).toBe('200K');
    });

    it('formats small numbers as-is', () => {
      expect(formatTokenLimit(500)).toBe('500');
    });
  });

  describe('tokColor', () => {
    it('returns a color for each threshold', () => {
      expect(tokColor(0)).toBeDefined();
      expect(tokColor(50)).toBeDefined();
      expect(tokColor(80)).toBeDefined();
      expect(tokColor(95)).toBeDefined();
      expect(tokColor(100)).toBeDefined();
    });
  });
});
