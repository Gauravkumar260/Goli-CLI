import { describe, expect, it } from 'vitest';
import { partitionMessages } from '../../apps/cli/src/tui/components/HistoryScroll.js';
import type { Message } from '../../apps/cli/src/tui/state/types.js';

function mkMsg(id: string, overrides: Partial<Message> = {}): Message {
  return { id, type: 'user', content: id, streaming: false, ...overrides } as Message;
}

describe('partitionMessages', () => {
  it('returns empty arrays for empty history', () => {
    expect(partitionMessages([])).toEqual({ completed: [], streaming: [] });
  });

  it('captures every concurrently streaming agent message', () => {
    const messages = [
      mkMsg('a', { type: 'agent', streaming: true }),
      mkMsg('b', { type: 'agent', streaming: true }),
      mkMsg('c'),
    ];
    const { streaming, completed } = partitionMessages(messages);
    expect(streaming.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(completed.map((m) => m.id)).toEqual(['c']);
  });

  it('keeps completed messages in chronological (oldest-first) order', () => {
    const messages = [mkMsg('old'), mkMsg('mid'), mkMsg('new')];
    expect(partitionMessages(messages).completed.map((m) => m.id)).toEqual([
      'old', 'mid', 'new',
    ]);
  });

  it('is monotonic: appending a message never changes the prefix already returned', () => {
    const base = [mkMsg('1'), mkMsg('2')];
    const first = partitionMessages(base).completed.map((m) => m.id);
    const grown = partitionMessages([...base, mkMsg('3')]).completed.map((m) => m.id);
    expect(grown.slice(0, first.length)).toEqual(first);
  });

  it('a non-agent message never counts as streaming even if streaming:true is set incorrectly', () => {
    const { streaming, completed } = partitionMessages([
      mkMsg('x', { type: 'user', streaming: true } as Partial<Message>),
    ]);
    expect(streaming).toEqual([]);
    expect(completed.map((m) => m.id)).toEqual(['x']);
  });
});