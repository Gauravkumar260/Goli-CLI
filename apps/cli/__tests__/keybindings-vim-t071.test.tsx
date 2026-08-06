/**
 * Tests for T-071: Keybinding collision fix + Ctrl+L clear screen +
 * vim mode indicator.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { globalKeyMap, DEFAULT_BINDINGS } from '../src/tui/lib/keymap.js';
import { PromptInput } from '../src/tui/components/PromptInput.js';

// Helper: find a binding by action name from the tuple array.
function findBinding(action: string): { keys: string[]; category: string } | undefined {
  const entry = DEFAULT_BINDINGS.find(([a]) => a === action);
  if (!entry) return undefined;
  return { keys: entry[1].defaultKeys, category: entry[1].category };
}

// ─── Keymap collision fix ───────────────────────────────────────────

describe('T-071: keymap collision fix', () => {
  it('copyResponse uses ctrl+shift+c (not ctrl+o)', () => {
    const binding = findBinding('copyResponse');
    expect(binding).toBeDefined();
    expect(binding!.keys).toContain('ctrl+shift+c');
    expect(binding!.keys).not.toContain('ctrl+o');
  });

  it('openEditor still uses ctrl+o', () => {
    const binding = findBinding('openEditor');
    expect(binding).toBeDefined();
    expect(binding!.keys).toContain('ctrl+o');
  });

  it('copyResponse and openEditor do NOT share any key', () => {
    const copyBinding = findBinding('copyResponse')!;
    const editorBinding = findBinding('openEditor')!;
    const shared = copyBinding.keys.filter((k) => editorBinding.keys.includes(k));
    expect(shared).toHaveLength(0);
  });

  it('clearScreen action exists with ctrl+l binding', () => {
    const binding = findBinding('clearScreen');
    expect(binding).toBeDefined();
    expect(binding!.keys).toContain('ctrl+l');
  });

  it('clearScreen is in the navigation category', () => {
    const binding = findBinding('clearScreen');
    expect(binding).toBeDefined();
    expect(binding!.category).toBe('navigation');
  });

  it('globalKeyMap resolves clearScreen action', () => {
    const entry = globalKeyMap.get('clearScreen');
    expect(entry).toBeDefined();
  });

  it('globalKeyMap resolves copyResponse with updated keys', () => {
    const keys = globalKeyMap.keysFor('copyResponse');
    expect(keys).toContain('ctrl+shift+c');
    expect(keys).not.toContain('ctrl+o');
  });
});


// ─── PromptInput vim indicator ──────────────────────────────────────

describe('T-071: PromptInput vim mode indicator', () => {
  it('shows [INSERT] indicator when vimEnabled=true', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        vimEnabled={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[INSERT]');
  });

  it('does NOT show vim indicator when vimEnabled=false (default)', () => {
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
    expect(frame).not.toContain('[INSERT]');
    expect(frame).not.toContain('[NORMAL]');
  });

  it('renders without crashing when vimEnabled is true', () => {
    const { lastFrame } = render(
      <PromptInput
        onSubmit={() => {}}
        onAbort={() => {}}
        onQueue={() => {}}
        disabled={false}
        cols={80}
        vimEnabled={true}
      />,
    );
    expect(lastFrame() ?? '').toBeDefined();
  });
});
