/**
 * Tests for T-095: Queued messages tray UI + /queue command.
 *
 * Covers:
 *   - QueuedMessagesTray renders null when queue is empty
 *   - QueuedMessagesTray renders messages when queue has items
 *   - QueuedMessagesTray shows count in header
 *   - QueuedMessagesTray shows message text
 *   - QueuedMessagesTray shows age
 *   - QueuedMessagesTray shows "+N more" when exceeding maxShow
 *   - /queue command is registered
 *   - /queue (no args) lists messages
 *   - /queue clear clears the queue
 *   - /queue has /q and /queued aliases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { QueuedMessagesTray } from '../src/tui/components/QueuedMessagesTray.js';
import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';
import type { QueuedMessage } from '../src/tui/state/types.js';

beforeEach(() => {
  AppStateStore.clearQueue();
  registerDefaultCommands();
});

function makeQueuedMessage(text: string, ageSec = 5): QueuedMessage {
  return { text, timestamp: Date.now() - ageSec * 1000 };
}

// ─── QueuedMessagesTray rendering ───────────────────────────────────

describe('T-095: QueuedMessagesTray rendering', () => {
  it('renders null when queue is empty', () => {
    const { lastFrame } = render(
      <QueuedMessagesTray messages={[]} cols={80} />,
    );
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders messages when queue has items', () => {
    const msgs = [makeQueuedMessage('fix the bug')];
    const { lastFrame } = render(
      <QueuedMessagesTray messages={msgs} cols={80} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Queued');
    expect(frame).toContain('fix the bug');
  });

  it('shows count in header', () => {
    const msgs = [
      makeQueuedMessage('msg 1'),
      makeQueuedMessage('msg 2'),
      makeQueuedMessage('msg 3'),
    ];
    const { lastFrame } = render(
      <QueuedMessagesTray messages={msgs} cols={80} />,
    );
    expect(lastFrame() ?? '').toContain('Queued (3)');
  });

  it('shows age for each message', () => {
    const msgs = [makeQueuedMessage('test', 10)];
    const { lastFrame } = render(
      <QueuedMessagesTray messages={msgs} cols={80} />,
    );
    expect(lastFrame() ?? '').toContain('10s ago');
  });

  it('shows +N more when exceeding maxShow', () => {
    const msgs = [
      makeQueuedMessage('msg 1'),
      makeQueuedMessage('msg 2'),
      makeQueuedMessage('msg 3'),
    ];
    const { lastFrame } = render(
      <QueuedMessagesTray messages={msgs} cols={80} maxShow={2} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('+1 more');
  });

  it('truncates long message text', () => {
    const longText = 'a'.repeat(100);
    const msgs = [makeQueuedMessage(longText)];
    const { lastFrame } = render(
      <QueuedMessagesTray messages={msgs} cols={40} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('…');
    expect(frame).not.toContain('a'.repeat(100));
  });
});


// ─── /queue command ─────────────────────────────────────────────────

describe('T-095: /queue command', () => {
  it('is registered in the command registry', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'queue');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('queue');
  });

  it('has /queued as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'queue');
    expect(cmd?.altNames).toContain('queued');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'queue');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('shows empty message when queue is empty', () => {
    const cmd = globalCommands.resolve('queue');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]![0].toLowerCase()).toContain('empty');
    pushSpy.mockRestore();
  });

  it('lists messages when queue has items', () => {
    AppStateStore.queueMessage('fix the bug');
    AppStateStore.queueMessage('add tests');

    const cmd = globalCommands.resolve('queue');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Queued messages (2)');
    expect(msg).toContain('fix the bug');
    expect(msg).toContain('add tests');
    pushSpy.mockRestore();
  });

  it('clears the queue with /queue clear', () => {
    AppStateStore.queueMessage('msg 1');
    AppStateStore.queueMessage('msg 2');
    expect(AppStateStore.getSnapshot().queuedMessages.length).toBe(2);

    const cmd = globalCommands.resolve('queue');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    expect(AppStateStore.getSnapshot().queuedMessages.length).toBe(0);
    expect(pushSpy.mock.calls[0]![0]).toContain('Cleared 2');
    pushSpy.mockRestore();
  });

  it('shows singular "message" when clearing 1', () => {
    AppStateStore.queueMessage('only one');
    const cmd = globalCommands.resolve('queue');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    expect(pushSpy.mock.calls[0]![0]).toContain('Cleared 1 queued message');
    expect(pushSpy.mock.calls[0]![0]).not.toContain('messages');
    pushSpy.mockRestore();
  });
});
