/**
 * Tests for T-073: Fix version strings + fix always-true updateAvailable.
 *
 * Covers:
 *   - SplashBox uses APP_VERSION (not hardcoded v1.0.0)
 *   - SplashBox does NOT show update-available warning by default
 *   - SplashBox shows update-available warning only when updateAvailable=true
 *   - APP_VERSION in constants matches package.json
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { readFileSync } from 'node:fs';

import { SplashBox } from '../src/tui/components/SplashBox.js';
import { APP_VERSION } from '../src/constants.js';

// Read version from package.json for cross-validation.
const pkgJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
);
const PKG_VERSION = pkgJson.version;

// ─── Version string consistency ─────────────────────────────────────

describe('T-073: version string consistency', () => {
  it('APP_VERSION in constants matches package.json version', () => {
    expect(APP_VERSION).toBe(PKG_VERSION);
  });

  it('SplashBox renders APP_VERSION (not hardcoded v1.0.0)', () => {
    const { lastFrame } = render(
      <SplashBox
        model="test-model"
        mode="SAFE"
        tier="T1"
        tokens={100}
        tokenLimit={10000}
        bootstrapMs={300}
        sessionId="test-session-1234"
      />,
    );
    const frame = lastFrame() ?? '';
    // Should contain the real version, not v1.0.0
    expect(frame).toContain(APP_VERSION);
    expect(frame).not.toContain('v1.0.0');
  });
});


// ─── updateAvailable default ────────────────────────────────────────

describe('T-073: updateAvailable defaults to false', () => {
  it('does NOT show update warning by default', () => {
    const { lastFrame } = render(
      <SplashBox
        model="test-model"
        mode="SAFE"
        tier="T1"
        tokens={100}
        tokenLimit={10000}
        bootstrapMs={300}
        sessionId="test-session-1234"
      />,
    );
    const frame = lastFrame() ?? '';
    // Should NOT show update-available warning by default
    expect(frame).not.toMatch(/update available/i);
  });

  it('shows update warning when updateAvailable=true', () => {
    const { lastFrame } = render(
      <SplashBox
        model="test-model"
        mode="SAFE"
        tier="T1"
        tokens={100}
        tokenLimit={10000}
        bootstrapMs={300}
        sessionId="test-session-1234"
        updateAvailable={true}
      />,
    );
    const frame = lastFrame() ?? '';
    // Should show update-available warning when explicitly set to true
    expect(frame.toLowerCase()).toContain('update');
  });
});
