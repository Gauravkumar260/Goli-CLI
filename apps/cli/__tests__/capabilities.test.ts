/**
 * Unit tests for terminal capabilities detection.
 *
 * Note: detectCapabilities() caches its result for the process lifetime.
 * These tests verify the function's behavior with the understanding that
 * the cache may reflect the first call's environment.
 */

import { describe, it, expect } from 'vitest';

import {
  detectCapabilities,
  shouldUseSyncOutput,
  shouldThrottleAnimations,
} from '../src/tui/lib/capabilities.js';

describe('capabilities', () => {
  it('detectCapabilities returns an object with all expected fields', () => {
    const caps = detectCapabilities();
    expect(caps).toHaveProperty('trueColor');
    expect(caps).toHaveProperty('colors256');
    expect(caps).toHaveProperty('unicode');
    expect(caps).toHaveProperty('syncOutput');
    expect(caps).toHaveProperty('isSSH');
    expect(caps).toHaveProperty('isWindowsTerminal');
    expect(caps).toHaveProperty('isTmux');
    expect(caps).toHaveProperty('accessibility');
    expect(caps).toHaveProperty('debug');
    expect(typeof caps.trueColor).toBe('boolean');
    expect(typeof caps.isSSH).toBe('boolean');
  });

  it('detectCapabilities caches the result (same reference)', () => {
    const a = detectCapabilities();
    const b = detectCapabilities();
    expect(a).toBe(b);
  });

  it('shouldUseSyncOutput returns a boolean', () => {
    expect(typeof shouldUseSyncOutput()).toBe('boolean');
  });

  it('shouldThrottleAnimations returns a boolean', () => {
    expect(typeof shouldThrottleAnimations()).toBe('boolean');
  });
});
