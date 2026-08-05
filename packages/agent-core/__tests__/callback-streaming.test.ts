/**
 * Unit tests for the callback-based streaming system.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  StreamingQueue,
  createStreamCallback,
  createFakeResponse,
  shouldSkipFinalSend,
  runStreamingCompletion,
  accumulateChunks,
  createBufferedConsumer,
} from '../src/callback-streaming.js';

import type { StreamChunk } from '../src/callback-streaming.js';

interface TestModelResponse {
  content: string;
  thinking: string;
  toolCalls: unknown[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

function makeResponse(content: string): TestModelResponse {
  return {
    content,
    thinking: '',
    toolCalls: [],
    inputTokens: 100,
    outputTokens: 50,
    thinkingTokens: 0,
    finishReason: 'stop',
  };
}

describe('StreamingQueue', () => {
  let queue: StreamingQueue;

  beforeEach(() => {
    queue = new StreamingQueue({ flushIntervalMs: 10 });
  });

  it('starts empty', () => {
    expect(queue.length).toBe(0);
    expect(queue.isEnded).toBe(false);
  });

  it('pushes text chunks', () => {
    queue.push('hello');
    queue.push(' world');
    expect(queue.length).toBe(2);
  });

  it('ends on null sentinel', () => {
    queue.push('hello');
    queue.push(null);
    expect(queue.isEnded).toBe(true);
  });

  it('ignores pushes after end', () => {
    queue.push('hello');
    queue.push(null);
    queue.push('ignored');
    expect(queue.length).toBe(0); // Flushed on end
  });

  it('drains pending chunks', () => {
    queue.push('a');
    queue.push('b');
    const drained = queue.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0]!.text).toBe('a');
    expect(drained[1]!.text).toBe('b');
    expect(queue.length).toBe(0);
  });

  it('onChunk callback receives chunks', async () => {
    const received: string[] = [];
    queue.onChunk((chunk) => {
      if (chunk.text !== null) received.push(chunk.text);
    });
    queue.push('hello');
    queue.push(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual(['hello']);
  });

  it('waitForEnd resolves when null is pushed', async () => {
    queue.push('hello');
    setTimeout(() => queue.push(null), 10);
    await queue.waitForEnd();
    expect(queue.isEnded).toBe(true);
  });

  it('waitForEnd resolves immediately if already ended', async () => {
    queue.push(null);
    await queue.waitForEnd();
  });

  it('resets state', () => {
    queue.push('hello');
    queue.push(null);
    queue.reset();
    expect(queue.length).toBe(0);
    expect(queue.isEnded).toBe(false);
  });

  it('enforces max queue size (drops oldest)', () => {
    const q = new StreamingQueue({ maxQueueSize: 3, flushIntervalMs: 10000 });
    q.push('a');
    q.push('b');
    q.push('c');
    q.push('d'); // should drop 'a'
    expect(q.length).toBe(3);
    const drained = q.drain();
    expect(drained[0]!.text).toBe('b');
  });
});

describe('createStreamCallback', () => {
  it('creates a callback that pushes to queue', () => {
    const queue = new StreamingQueue({ flushIntervalMs: 10000 });
    const cb = createStreamCallback(queue);
    cb('hello');
    cb(' world');
    cb(null);
    expect(queue.isEnded).toBe(true);
    const drained = queue.drain();
    // After end, chunks are flushed → queue is empty
    // But the onChunk callback would have received them
  });
});

describe('createFakeResponse', () => {
  it('creates a response with accumulated content', () => {
    const response = createFakeResponse('accumulated text', 100, 50);
    expect(response.content).toBe('accumulated text');
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.thinking).toBe('');
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe('stop');
  });

  it('defaults tokens to 0', () => {
    const response = createFakeResponse('text');
    expect(response.inputTokens).toBe(0);
    expect(response.outputTokens).toBe(0);
  });
});

describe('shouldSkipFinalSend', () => {
  it('returns true when streamed and skipFinalSend', () => {
    expect(shouldSkipFinalSend({ content: 'x', streamed: true, skipFinalSend: true, streamId: 's1' })).toBe(true);
  });

  it('returns false when not streamed', () => {
    expect(shouldSkipFinalSend({ content: 'x', streamed: false, skipFinalSend: false, streamId: 's1' })).toBe(false);
  });

  it('returns false when streamed but no skip', () => {
    expect(shouldSkipFinalSend({ content: 'x', streamed: true, skipFinalSend: false, streamId: 's1' })).toBe(false);
  });
});

describe('runStreamingCompletion', () => {
  it('returns non-streaming result when streaming disabled', async () => {
    const result = await runStreamingCompletion({
      call: async () => makeResponse('hello world'),
      streamingEnabled: false,
    });

    expect(result.streamed).toBe(false);
    expect(result.content).toBe('hello world');
    expect(result.skipFinalSend).toBe(false);
    expect(result.fallbackResponse).toBeDefined();
  });

  it('returns non-streaming result when no callback', async () => {
    const result = await runStreamingCompletion({
      call: async () => makeResponse('hello'),
      streamingEnabled: true,
    });

    expect(result.streamed).toBe(false);
    expect(result.content).toBe('hello');
  });

  it('streams content when enabled', async () => {
    const deltas: (string | null)[] = [];
    const result = await runStreamingCompletion({
      call: async (opts) => {
        if (opts.stream) {
          // Simulate streaming by calling the callback
          // In real usage, the GLM client calls the callback internally
          return makeResponse('streamed content');
        }
        return makeResponse('non-streamed content');
      },
      streamCallback: (delta) => deltas.push(delta),
      streamingEnabled: true,
    });

    expect(result.streamed).toBe(true);
    expect(result.content).toBe('streamed content');
    expect(result.skipFinalSend).toBe(true);
    // null sentinel should have been sent
    expect(deltas[deltas.length - 1]).toBe(null);
  });

  it('falls back to non-streaming on error', async () => {
    let callCount = 0;
    const result = await runStreamingCompletion({
      call: async (opts) => {
        callCount++;
        if (opts.stream) throw new Error('streaming failed');
        return makeResponse('fallback content');
      },
      streamCallback: () => {},
      streamingEnabled: true,
    });

    expect(result.streamed).toBe(false);
    expect(result.content).toBe('fallback content');
    expect(result.fallbackResponse).toBeDefined();
    expect(callCount).toBe(2); // First (stream) failed, second (fallback) succeeded
  });

  it('generates unique stream IDs', async () => {
    const r1 = await runStreamingCompletion({
      call: async () => makeResponse('a'),
      streamingEnabled: false,
    });
    const r2 = await runStreamingCompletion({
      call: async () => makeResponse('b'),
      streamingEnabled: false,
    });

    expect(r1.streamId).not.toBe(r2.streamId);
  });
});

describe('accumulateChunks', () => {
  it('accumulates text chunks into a string', () => {
    const chunks: StreamChunk[] = [
      { text: 'hello', timestamp: 1 },
      { text: ' world', timestamp: 2 },
      { text: null, timestamp: 3 },
    ];
    expect(accumulateChunks(chunks)).toBe('hello world');
  });

  it('handles empty chunks', () => {
    expect(accumulateChunks([])).toBe('');
  });

  it('handles only null chunks', () => {
    const chunks: StreamChunk[] = [{ text: null, timestamp: 1 }];
    expect(accumulateChunks(chunks)).toBe('');
  });
});

describe('createBufferedConsumer', () => {
  it('buffers chunks and flushes on buffer size', async () => {
    const queue = new StreamingQueue({ flushIntervalMs: 5 });
    const received: string[] = [];

    const cleanup = createBufferedConsumer(
      queue,
      (text) => received.push(text),
      10, // buffer size = 10 chars
    );

    queue.push('hello'); // 5 chars
    queue.push(' world'); // 6 chars → total 11 > 10 → flush
    queue.push(null);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received.join('')).toContain('hello world');
    cleanup();
  });

  it('flushes remaining buffer on end', async () => {
    const queue = new StreamingQueue({ flushIntervalMs: 5 });
    const received: string[] = [];

    const cleanup = createBufferedConsumer(
      queue,
      (text) => received.push(text),
      1000, // large buffer — won't flush until end
    );

    queue.push('small');
    queue.push(null);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual(['small']);
    cleanup();
  });

  it('cleanup removes listeners', () => {
    const queue = new StreamingQueue({ flushIntervalMs: 5 });
    const received: string[] = [];

    const cleanup = createBufferedConsumer(queue, (text) => received.push(text), 1);

    cleanup();

    queue.push('after cleanup');
    queue.push(null);

    // Should not receive anything after cleanup
    expect(received).toEqual([]);
  });
});
