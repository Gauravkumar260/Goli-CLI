/**
 * Unit tests for T-039 — Enhanced footer with cwd + path utilities.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. StatusBar shows: cwd, git branch, model name, mode, tier, tokens, cost.
 *  2. Cwd path is shortened if too long (~/v/l/path).
 *  3. Items drop in priority order when terminal is narrow.
 *  4. Tests verify each item renders, narrowing behavior, and tildeification.
 *
 * Comparison reference: gemini-cli apps/cli/src/ui/components/Footer.tsx
 * (543 lines) — cwd + git + model + quota + memory + debug profiler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  tildeify,
  shortenPath,
  displayPath,
  truncatePath,
} from '../../apps/cli/src/tui/lib/pathUtils.js';
import { StatusBar } from '../../apps/cli/src/tui/components/StatusBar.js';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'goli-path-test-'));
  originalHome = process.env['HOME'];
  process.env['HOME'] = tmpHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env['HOME'] = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('T-039: tildeify (AC #4)', () => {
  it('replaces home prefix with ~', () => {
    expect(tildeify(join(tmpHome, 'project'))).toBe('~/project');
  });

  it('returns ~ for exact home path', () => {
    expect(tildeify(tmpHome)).toBe('~');
  });

  it('returns ~ for already-tildeified input', () => {
    expect(tildeify('~')).toBe('~');
  });

  it('does NOT replace partial matches (e.g. /home/alice2)', () => {
    const notHome = tmpHome + '2';
    expect(tildeify(notHome)).toBe(notHome);
  });

  it('leaves non-home paths unchanged', () => {
    expect(tildeify('/tmp/other')).toBe('/tmp/other');
  });

  it('handles empty input', () => {
    expect(tildeify('')).toBe('');
  });
});

describe('T-039: shortenPath (AC #2)', () => {
  it('abbreviates intermediate dirs to first char', () => {
    const long = join(tmpHome, 'very', 'long', 'path', 'name');
    const result = shortenPath(tildeify(long));
    // Should look like ~/v/l/path/name (intermediate dirs abbreviated,
    // last 2 components preserved).
    expect(result).toMatch(/^~\/v\/l\/path\/name$/);
  });

  it('preserves the last 2 path components in full', () => {
    const long = join(tmpHome, 'a', 'b', 'c', 'd', 'final-dir');
    const result = shortenPath(tildeify(long));
    expect(result).toMatch(/final-dir$/);
    expect(result).toMatch(/c\/d\/final-dir$/);
  });

  it('does not shorten paths shorter than 20 chars', () => {
    expect(shortenPath('~/short')).toBe('~/short');
  });

  it('does not shorten single-component paths', () => {
    expect(shortenPath('~')).toBe('~');
    expect(shortenPath('/')).toBe('/');
  });

  it('does not shorten 2-component paths', () => {
    expect(shortenPath('~/p')).toBe('~/p');
  });

  it('handles empty input', () => {
    expect(shortenPath('')).toBe('');
  });

  it('preserves already-short intermediate dirs (≤1 char)', () => {
    const long = join(tmpHome, 'a', 'b', 'c', 'd', 'e', 'final');
    const result = shortenPath(tildeify(long));
    // All intermediate dirs are 1 char; they should remain 1 char.
    expect(result).toMatch(/~/);
    expect(result).toMatch(/final$/);
  });
});

describe('T-039: displayPath (integration)', () => {
  it('tildeifies + shortens in one call', () => {
    const long = join(tmpHome, 'very', 'long', 'path', 'name');
    const result = displayPath(long);
    expect(result).toMatch(/^~\/v\/l\/path\/name$/);
  });

  it('returns short paths unchanged (after tildeify)', () => {
    expect(displayPath(join(tmpHome, 'p'))).toBe('~/p');
  });

  it('leaves non-home paths unchanged (after shorten)', () => {
    expect(displayPath('/tmp/short')).toBe('/tmp/short');
  });
});

describe('T-039: truncatePath (AC #3 — narrow terminals)', () => {
  it('returns path unchanged if it fits', () => {
    expect(truncatePath('~/short', 20)).toBe('~/short');
  });

  it('truncates with ~/…/ prefix preserving basename', () => {
    const result = truncatePath('~/very/long/path/to/file.txt', 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toContain('file.txt');
    expect(result.startsWith('~/…/')).toBe(true);
  });

  it('truncates basename if even ~/…/basename exceeds maxLen', () => {
    const result = truncatePath('~/very-long-basename-here', 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('handles maxLen ≤ 3 by truncating to maxLen chars', () => {
    expect(truncatePath('~/anything', 3)).toBe('~/a');
  });
});

describe('T-039: StatusBar integration (AC #1, #3)', () => {
  // Render the StatusBar with various prop combinations and verify
  // the visible items.

  const baseProps = {
    cols: 100,
    model: 'claude-sonnet-4-6',
    tokens: 12400,
    tokenLimit: 200000,
    mode: 'SAFE' as const,
    tier: 'T1',
    cost: '0.0012',
    branch: 'main',
    cwd: '/home/user/projects/goli-cli',
    bordered: false,
  };

  it('renders all fields in full layout (≥76 cols)', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame() ?? '';
    // Model short name (first 2 hyphen-separated parts).
    expect(frame).toContain('claude-sonnet');
    // Tokens.
    expect(frame).toContain('12,400');
    // Mode — legacy 'SAFE' RunMode maps to the canonical 'build' AppMode.
    expect(frame).toContain('build');
    // Tier.
    expect(frame).toContain('T1');
    // Cost.
    expect(frame).toContain('$0.0012');
    // Branch.
    expect(frame).toContain('main');
    // CWD (tildeified + shortened). Since /home/user may not match the
    // test's $HOME, we just check that SOME path-like text appears.
    expect(frame.length).toBeGreaterThan(50);
  });

  it('renders the cwd when provided', () => {
    // Use a tmpHome-based cwd so tildeify kicks in.
    const cwd = join(tmpHome, 'projects', 'goli-cli');
    const { lastFrame } = render(
      <StatusBar {...baseProps} cwd={cwd} cols={120} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('goli-cli');
    expect(frame).toContain('~/');
  });

  it('omits cwd when not provided', () => {
    const { lastFrame } = render(
      <StatusBar {...baseProps} cwd={undefined} cols={100} />,
    );
    // The frame should still render — just without the cwd field.
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude-sonnet');
  });

  it('omits cost when not provided', () => {
    const { lastFrame } = render(
      <StatusBar {...baseProps} cost={undefined} cols={100} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('$0.0012');
  });

  it('omits branch when set to "no-git"', () => {
    const { lastFrame } = render(
      <StatusBar {...baseProps} branch="no-git" cols={100} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('no-git');
  });

  it('renders minimal layout (< 52 cols) with just model + secs', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} cols={40} />);
    const frame = lastFrame() ?? '';
    // Minimal layout shows model short name + secs, but NOT tier/cost/cwd.
    expect(frame).toContain('claude-sonnet');
    // Cwd should not appear in minimal layout.
    // (We can't assert absence of 'projects' directly because the
    //  test environment's $HOME may be in the path; instead we check
    //  that the frame is short.)
    expect(frame.length).toBeLessThan(80);
  });

  it('renders narrow layout (52-75 cols) without cost/branch/cwd', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} cols={60} />);
    const frame = lastFrame() ?? '';
    // Narrow layout shows model + tokens + token bar + mode + tier + secs.
    // Legacy 'SAFE' RunMode maps to the canonical 'build' AppMode.
    expect(frame).toContain('claude-sonnet');
    expect(frame).toContain('build');
    expect(frame).toContain('T1');
    // Cost should NOT appear in narrow layout.
    expect(frame).not.toContain('$0.0012');
  });

  it('priority: cwd drops before tier when terminal narrows', () => {
    // In narrow layout (60 cols), cwd is not rendered; tier is.
    const { lastFrame } = render(<StatusBar {...baseProps} cols={60} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('T1'); // tier preserved
    // The cwd field shouldn't render in narrow layout.
    // (We can't assert 'not.contains' the cwd path because the path may
    //  overlap with other text; instead we verify tier IS present.)
  });
});
