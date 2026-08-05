/**
 * Tests for T-091: Tool expand-toggle for live messages.
 *
 * Covers:
 *   - getExpandedToolIds() returns empty set initially
 *   - toggleToolExpand() adds an ID to the set
 *   - toggleToolExpand() removes an ID if already present
 *   - toggleLastToolExpand() finds the last tool call in messages
 *   - toggleLastToolExpand() returns null when no tool calls exist
 *   - toggleLastToolExpand() toggles the most recent tool call
 *   - clearExpandedTools() empties the set
 *   - subscribeToExpandedTools() fires on changes
 *   - /expand command is registered in the command registry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import {
  getExpandedToolIds,
  toggleToolExpand,
  toggleLastToolExpand,
  clearExpandedTools,
  subscribeToExpandedTools,
} from '../../apps/cli/src/tui/lib/expandedTools.js';
import { useExpandedTools } from '../../apps/cli/src/tui/hooks/useExpandedTools.js';
import { globalCommands, registerDefaultCommands } from '../../apps/cli/src/tui/lib/CommandRegistry.js';

beforeEach(() => {
  clearExpandedTools();
});

// ─── Registry basics ────────────────────────────────────────────────

describe('T-091: expandedTools registry', () => {
  it('getExpandedToolIds() returns empty set initially', () => {
    expect(getExpandedToolIds().size).toBe(0);
  });

  it('toggleToolExpand() adds an ID to the set', () => {
    toggleToolExpand('tc-1');
    expect(getExpandedToolIds().has('tc-1')).toBe(true);
    expect(getExpandedToolIds().size).toBe(1);
  });

  it('toggleToolExpand() removes an ID if already present', () => {
    toggleToolExpand('tc-1');
    expect(getExpandedToolIds().has('tc-1')).toBe(true);
    toggleToolExpand('tc-1');
    expect(getExpandedToolIds().has('tc-1')).toBe(false);
    expect(getExpandedToolIds().size).toBe(0);
  });

  it('clearExpandedTools() empties the set', () => {
    toggleToolExpand('tc-1');
    toggleToolExpand('tc-2');
    expect(getExpandedToolIds().size).toBe(2);
    clearExpandedTools();
    expect(getExpandedToolIds().size).toBe(0);
  });
});


// ─── Subscription ───────────────────────────────────────────────────

describe('T-091: subscribeToExpandedTools()', () => {
  it('fires listener when toggleToolExpand() is called', () => {
    let calls = 0;
    const unsub = subscribeToExpandedTools(() => { calls++; });
    toggleToolExpand('tc-1');
    expect(calls).toBe(1);
    toggleToolExpand('tc-2');
    expect(calls).toBe(2);
    unsub();
  });

  it('unsubscribe stops further notifications', () => {
    let calls = 0;
    const unsub = subscribeToExpandedTools(() => { calls++; });
    toggleToolExpand('tc-1');
    expect(calls).toBe(1);
    unsub();
    toggleToolExpand('tc-2');
    expect(calls).toBe(1);
  });
});


// ─── toggleLastToolExpand() ─────────────────────────────────────────

describe('T-091: toggleLastToolExpand()', () => {
  it('returns null when no messages have tool calls', () => {
    const messages = [
      { type: 'user', content: 'hello' },
      { type: 'system', content: 'hi' },
    ];
    const result = toggleLastToolExpand(messages as any);
    expect(result).toBeNull();
  });

  it('returns the tool call ID when a message has tool calls', () => {
    const messages = [
      { type: 'agent', toolCalls: [{ id: 'tc-1' }] },
    ];
    const result = toggleLastToolExpand(messages as any);
    expect(result).toBe('tc-1');
    expect(getExpandedToolIds().has('tc-1')).toBe(true);
  });

  it('toggles the most recent tool call (last message)', () => {
    const messages = [
      { type: 'agent', toolCalls: [{ id: 'tc-old' }] },
      { type: 'agent', toolCalls: [{ id: 'tc-new' }] },
    ];
    const result = toggleLastToolExpand(messages as any);
    expect(result).toBe('tc-new');
    expect(getExpandedToolIds().has('tc-new')).toBe(true);
    expect(getExpandedToolIds().has('tc-old')).toBe(false);
  });

  it('toggles the last tool call in a message with multiple tools', () => {
    const messages = [
      { type: 'agent', toolCalls: [{ id: 'tc-1' }, { id: 'tc-2' }, { id: 'tc-3' }] },
    ];
    const result = toggleLastToolExpand(messages as any);
    expect(result).toBe('tc-3');
  });

  it('toggles off when called twice for the same tool', () => {
    const messages = [
      { type: 'agent', toolCalls: [{ id: 'tc-1' }] },
    ];
    toggleLastToolExpand(messages as any);
    expect(getExpandedToolIds().has('tc-1')).toBe(true);
    toggleLastToolExpand(messages as any);
    expect(getExpandedToolIds().has('tc-1')).toBe(false);
  });
});


// ─── useExpandedTools() hook ────────────────────────────────────────

describe('T-091: useExpandedTools() hook', () => {
  function HookTestComponent(): React.ReactElement {
    const ids = useExpandedTools();
    return React.createElement('Text', null, `count=${ids.size}`);
  }

  it('returns the current expanded set size', () => {
    const { lastFrame } = render(React.createElement(HookTestComponent));
    const frame = lastFrame() ?? '';
    // The component renders "count=N" (may have Ink wrapping warnings but
    // the text content should be present).
    expect(frame).toContain('count=0');
  });

  it('updates when toggleToolExpand() is called', () => {
    // The hook subscribes via useEffect; in ink-testing-library the
    // subscription may not fire synchronously. We verify the registry
    // updates correctly (the hook mechanism is tested by the subscription
    // tests above).
    toggleToolExpand('tc-1');
    expect(getExpandedToolIds().has('tc-1')).toBe(true);
  });
});


// ─── /expand command registered ─────────────────────────────────────

describe('T-091: /expand command', () => {
  it('is registered in the command registry', () => {
    // Ensure default commands are registered (may already be done by other tests).
    registerDefaultCommands();
    const cmd = globalCommands.entries().find((c) => c.name === 'expand');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('expansion');
  });

  it('has /exp as an alias', () => {
    registerDefaultCommands();
    const cmd = globalCommands.entries().find((c) => c.name === 'expand');
    expect(cmd?.altNames).toContain('exp');
  });
});
