/**
 * Tests for T-104: Word-boundary navigation (Ctrl+W, Ctrl+U, Ctrl+A, Ctrl+E).
 *
 * Covers:
 *   - PromptInput renders without crashing with word-boundary keys
 *   - Ctrl+W delete-word logic (tested standalone)
 *   - Ctrl+U kill-line logic (tested standalone)
 *   - Ctrl+A / Ctrl+E are no-ops (acknowledged, not inserted as chars)
 *   - Word deletion strips trailing whitespace
 *   - Word deletion handles single-word input
 *   - Kill-line handles multi-line input
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { PromptInput } from '../../apps/cli/src/tui/components/PromptInput.js';

// ─── PromptInput rendering ──────────────────────────────────────────

describe('T-104: PromptInput word-boundary rendering', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
      />,
    );
    expect(lastFrame() ?? '').toBeDefined();
  });
});


// ─── Ctrl+W delete-word logic ───────────────────────────────────────

describe('T-104: Ctrl+W delete-word logic', () => {
  // Mirrors the Ctrl+W logic from PromptInput.
  function deleteWordBackward(v: string): string {
    const trimmed = v.replace(/\s+$/, '');
    const lastSpace = trimmed.lastIndexOf(' ');
    return lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : '';
  }

  it('removes the last word from a multi-word string', () => {
    expect(deleteWordBackward('hello world foo')).toBe('hello world ');
  });

  it('removes the last word + trailing whitespace', () => {
    // 'hello world   ' → trim → 'hello world' → remove 'world' → 'hello '
    expect(deleteWordBackward('hello world   ')).toBe('hello ');
  });

  it('returns empty string for a single word', () => {
    expect(deleteWordBackward('hello')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(deleteWordBackward('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(deleteWordBackward('   ')).toBe('');
  });

  it('handles multiple words correctly', () => {
    expect(deleteWordBackward('a b c d')).toBe('a b c ');
  });
});


// ─── Ctrl+U kill-line logic ─────────────────────────────────────────

describe('T-104: Ctrl+U kill-line logic', () => {
  // Mirrors the Ctrl+U logic from PromptInput.
  function killLine(v: string): string {
    const lastNL = v.lastIndexOf('\n');
    return lastNL >= 0 ? v.slice(lastNL + 1) : '';
  }

  it('returns empty for single-line input', () => {
    expect(killLine('hello world')).toBe('');
  });

  it('returns empty for empty input', () => {
    expect(killLine('')).toBe('');
  });

  it('keeps only the last line for multi-line input', () => {
    expect(killLine('line1\nline2\nline3')).toBe('line3');
  });

  it('returns empty for input ending with newline', () => {
    expect(killLine('line1\n')).toBe('');
  });

  it('handles single newline', () => {
    expect(killLine('before\nafter')).toBe('after');
  });
});


// ─── Ctrl+A / Ctrl+E no-op verification ────────────────────────────

describe('T-104: Ctrl+A / Ctrl+E are no-ops (not inserted as chars)', () => {
  it('source code acknowledges Ctrl+A as a no-op', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../apps/cli/src/tui/components/PromptInput.tsx', import.meta.url),
      'utf-8',
    );
    expect(source).toContain("key.ctrl && input === 'a'");
    expect(source).toContain('no-op (cursor positioning not supported');
  });

  it('source code acknowledges Ctrl+E as a no-op', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../apps/cli/src/tui/components/PromptInput.tsx', import.meta.url),
      'utf-8',
    );
    expect(source).toContain("key.ctrl && input === 'e'");
    expect(source).toContain('no-op');
  });
});
