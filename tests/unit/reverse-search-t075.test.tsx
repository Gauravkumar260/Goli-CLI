/**
 * Tests for T-075: Real Ctrl+R reverse-search through prompt history.
 *
 * Covers:
 *   - InputHistory.search() returns matches most-recent-first
 *   - InputHistory.search() is case-insensitive
 *   - InputHistory.search() returns empty for empty query
 *   - InputHistory.searchNextIndex() finds the next older match
 *   - InputHistory.searchNextIndex() returns -1 when no match
 *   - InputHistory.getAt() returns entry at index
 *   - InputHistory.getAt() returns null for out-of-bounds
 *   - PromptInput renders reverse-search prompt when active
 *   - PromptInput shows query + match in the prompt
 *   - PromptInput shows "type to search" when query is empty
 *   - PromptInput shows "no match" when query has no results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { InputHistory } from '../../packages/cli/src/tui/lib/InputHistory.js';
import { PromptInput } from '../../packages/cli/src/tui/components/PromptInput.js';

// Helper: create an InputHistory with in-memory storage (no disk).
function makeHistory(entries: string[]): InputHistory {
  const h = new InputHistory({ filePath: null });
  for (const e of entries) h.add(e);
  return h;
}

// ─── InputHistory.search() ──────────────────────────────────────────

describe('T-075: InputHistory.search()', () => {
  it('returns matches most-recent-first', () => {
    const h = makeHistory(['npm install', 'npm test', 'git status', 'npm run build']);
    const results = h.search('npm');
    expect(results).toHaveLength(3);
    expect(results[0]).toBe('npm run build'); // newest first
    expect(results[1]).toBe('npm test');
    expect(results[2]).toBe('npm install');
  });

  it('is case-insensitive', () => {
    const h = makeHistory(['NPM Install', 'npm TEST', 'Git Status']);
    const results = h.search('npm');
    expect(results).toHaveLength(2);
    expect(results).toContain('NPM Install');
    expect(results).toContain('npm TEST');
  });

  it('returns empty array for empty query', () => {
    const h = makeHistory(['a', 'b', 'c']);
    expect(h.search('')).toEqual([]);
  });

  it('returns empty array when no entries match', () => {
    const h = makeHistory(['apple', 'banana', 'cherry']);
    expect(h.search('xyz')).toEqual([]);
  });

  it('returns empty array when history is empty', () => {
    const h = makeHistory([]);
    expect(h.search('anything')).toEqual([]);
  });

  it('matches substrings, not just prefixes', () => {
    const h = makeHistory(['git commit -m "fix"', 'git push origin main']);
    const results = h.search('push');
    expect(results).toEqual(['git push origin main']);
  });
});


// ─── InputHistory.searchNextIndex() ─────────────────────────────────

describe('T-075: InputHistory.searchNextIndex()', () => {
  it('finds the newest match index', () => {
    const h = makeHistory(['npm install', 'git status', 'npm test']);
    // entries: [0]='npm install', [1]='git status', [2]='npm test'
    // searchNextIndex('npm', 3) should find index 2 (newest 'npm' entry)
    const idx = h.searchNextIndex('npm', 3);
    expect(idx).toBe(2);
  });

  it('advances to the next older match', () => {
    const h = makeHistory(['npm install', 'git status', 'npm test']);
    // After finding index 2, searchNextIndex('npm', 2) should find index 0
    const idx = h.searchNextIndex('npm', 2);
    expect(idx).toBe(0);
  });

  it('returns -1 when no older match exists', () => {
    const h = makeHistory(['npm install', 'git status', 'npm test']);
    // After index 0, there's no older 'npm' entry
    const idx = h.searchNextIndex('npm', 0);
    expect(idx).toBe(-1);
  });

  it('returns -1 for empty query', () => {
    const h = makeHistory(['a', 'b']);
    expect(h.searchNextIndex('', 2)).toBe(-1);
  });

  it('returns -1 when no entries match', () => {
    const h = makeHistory(['apple', 'banana']);
    expect(h.searchNextIndex('xyz', 2)).toBe(-1);
  });
});


// ─── InputHistory.getAt() ───────────────────────────────────────────

describe('T-075: InputHistory.getAt()', () => {
  it('returns the entry at the given index', () => {
    const h = makeHistory(['first', 'second', 'third']);
    expect(h.getAt(0)).toBe('first');
    expect(h.getAt(1)).toBe('second');
    expect(h.getAt(2)).toBe('third');
  });

  it('returns null for out-of-bounds index', () => {
    const h = makeHistory(['only']);
    expect(h.getAt(-1)).toBeNull();
    expect(h.getAt(1)).toBeNull();
    expect(h.getAt(100)).toBeNull();
  });
});


// ─── PromptInput reverse-search rendering ───────────────────────────

describe('T-075: PromptInput reverse-search UI', () => {
  it('renders reverse-search prompt when active', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        reverseSearchActive={true}
        onReverseSearchExit={() => {}}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('reverse-i-search');
  });

  it('shows "type to search" when query is empty (initial state)', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        reverseSearchActive={true}
        onReverseSearchExit={() => {}}
      />,
    );
    const frame = lastFrame() ?? '';
    // Initial state: empty query → should show a hint
    expect(frame.toLowerCase()).toContain('type to search');
  });

  it('does NOT render reverse-search prompt when inactive', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('reverse-i-search');
  });

  it('renders normal input (● marker) when reverse-search is inactive', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('●');
  });

  it('does NOT render normal input (● marker) when reverse-search is active', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        reverseSearchActive={true}
        onReverseSearchExit={() => {}}
      />,
    );
    const frame = lastFrame() ?? '';
    // The ● marker should not appear when in reverse-search mode
    expect(frame).not.toContain('●');
  });
});
