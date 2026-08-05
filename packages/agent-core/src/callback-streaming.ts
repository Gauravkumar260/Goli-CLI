/**
 * Callback-based streaming with thread-safe queue bridge (Hermes pattern).
 *
 * Hermes uses a callback-based streaming architecture where the agent
 * thread calls `streamCallback(textDelta)` for each text chunk, and
 * `None` (null in TS) signals end-of-stream. A thread-safe queue
 * bridges the agent thread and the consumer (CLI, TUI, API server).
 *
 * ## Key design decisions
 *
 * - **Callback-based**: the agent calls `streamCallback(delta)` — the
 *   consumer doesn't need to poll or await
 * - **`null` end-of-stream sentinel**: `streamCallback(null)` signals
 *   that streaming is complete
 * - **Thread-safe queue bridge**: `StreamingQueue` bridges the agent
 *   thread and the consumer thread using a simple queue + event emitter
 * - **Fake response fallback**: if streaming fails, a `SimpleNamespace`-
 *   equivalent fake response is returned that mimics the non-streaming
 *   response shape — single code path, graceful fallback
 * - **Skip-final-send marker**: prevents duplicate messages when the
 *   streaming preview already delivered the response
 *
 * @module agent/callback-streaming
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

/** Minimal response shape for streaming completion fallback. */
interface ModelResponse {
  content: string;
  thinking: string;
  toolCalls: unknown[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

/** A stream callback function. `null` signals end-of-stream. */
export type StreamCallback = (textDelta: string | null) => void;

/** A streaming chunk in the queue. */
export interface StreamChunk {
  /** The text delta (null = end-of-stream). */
  text: string | null;
  /** The timestamp (epoch ms). */
  timestamp: number;
}

/** The result of a streaming chat completion. */
export interface StreamingResult {
  /** The full accumulated content. */
  content: string;
  /** Whether streaming succeeded. */
  streamed: boolean;
  /** Whether the final send was skipped (streaming preview delivered). */
  skipFinalSend: boolean;
  /** The non-streaming fallback response (if streaming failed). */
  fallbackResponse?: ModelResponse;
  /** The stream ID (for dedup). */
  streamId: string;
}

/** Options for the StreamingQueue. */
export interface StreamingQueueOptions {
  /** Max queue size (default: 1000 chunks). */
  maxQueueSize?: number;
  /** Flush interval in ms (default: 16 = ~60fps). */
  flushIntervalMs?: number;
}

/**
 * Thread-safe streaming queue — bridges the agent thread and consumer.
 *
 * The agent thread pushes chunks via `push()`; the consumer reads via
 * `onChunk()` callback or `drain()`. An `end` event signals completion.
 *
 * @module agent/callback-streaming
 */
export class StreamingQueue extends EventEmitter {
  private readonly chunks: StreamChunk[] = [];
  private readonly maxQueueSize: number;
  private readonly flushIntervalMs: number;
  private ended = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private onChunkCallback?: (chunk: StreamChunk) => void;

  constructor(opts: StreamingQueueOptions = {}) {
    super();
    this.maxQueueSize = opts.maxQueueSize ?? 1000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 16;
  }

  /**
   * Push a chunk to the queue (called from the agent thread).
   *
   * @param text - The text delta, or `null` for end-of-stream.
   */
  push(text: string | null): void {
    if (this.ended) return;

    const chunk: StreamChunk = { text, timestamp: Date.now() };

    // If queue is full, drop oldest (backpressure)
    if (this.chunks.length >= this.maxQueueSize) {
      this.chunks.shift();
    }

    this.chunks.push(chunk);

    // If end-of-stream, flush immediately and end
    if (text === null) {
      this.ended = true;
      this.flush();
      this.emit('end');
      this.stopFlushTimer();
      return;
    }

    // Start flush timer if not running
    if (!this.flushTimer) {
      this.startFlushTimer();
    }
  }

  /**
   * Set the chunk callback (called from the consumer thread).
   *
   * @param callback - The function to call for each chunk.
   */
  onChunk(callback: (chunk: StreamChunk) => void): void {
    this.onChunkCallback = callback;
  }

  /**
   * Drain all pending chunks (called from the consumer thread).
   *
   * @returns Array of chunks (empty if none pending).
   */
  drain(): StreamChunk[] {
    const pending = [...this.chunks];
    this.chunks.length = 0;
    return pending;
  }

  /**
   * Wait for the stream to end (returns a promise).
   */
  waitForEnd(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      this.once('end', () => resolve());
    });
  }

  /**
   * Check if the stream has ended.
   */
  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * Get the current queue length.
   */
  get length(): number {
    return this.chunks.length;
  }

  /**
   * Clear the queue and reset state.
   */
  reset(): void {
    this.chunks.length = 0;
    this.ended = false;
    this.stopFlushTimer();
  }

  // ─── Internal ──────────────────────────────────────────────────

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);

    // Unref so the timer doesn't keep the process alive
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flush(): void {
    if (this.chunks.length === 0) return;

    const chunks = this.drain();
    if (this.onChunkCallback) {
      for (const chunk of chunks) {
        this.onChunkCallback(chunk);
      }
    }

    // Also emit for EventEmitter listeners
    this.emit('flush', chunks);
  }
}

/**
 * Create a stream callback that pushes to a StreamingQueue.
 *
 * @param queue - The streaming queue to push to.
 * @returns The stream callback function.
 */
export function createStreamCallback(queue: StreamingQueue): StreamCallback {
  return (textDelta: string | null) => {
    queue.push(textDelta);
  };
}

/**
 * Create a fake response for graceful fallback (Hermes SimpleNamespace pattern).
 *
 * If streaming fails, this creates a response object that mimics the
 * non-streaming response shape — single code path, graceful fallback.
 *
 * @param accumulatedContent - The content accumulated before failure.
 * @param inputTokens - The input tokens consumed.
 * @param outputTokens - The output tokens consumed.
 * @returns A fake model response.
 */
export function createFakeResponse(
  accumulatedContent: string,
  inputTokens: number = 0,
  outputTokens: number = 0,
): ModelResponse {
  return {
    content: accumulatedContent,
    thinking: '',
    toolCalls: [],
    inputTokens,
    outputTokens,
    thinkingTokens: 0,
    finishReason: 'stop',
  };
}

/**
 * Check if a streaming result should skip the final send.
 *
 * If the streaming preview already delivered the full response to the
 * user (e.g., in a chat platform that shows streaming text), the final
 * non-streaming send would duplicate it. This marker prevents that.
 *
 * @param result - The streaming result.
 * @returns True if the final send should be skipped.
 */
export function shouldSkipFinalSend(result: StreamingResult): boolean {
  return result.streamed && result.skipFinalSend;
}

/**
 * Run a streaming chat completion with graceful fallback.
 *
 * If streaming succeeds, returns the accumulated content with
 * `streamed: true`. If streaming fails, falls back to a non-streaming
 * call and returns the response with `streamed: false`.
 *
 * @param params - The call parameters.
 * @param params.call
 * @param params.streamCallback
 * @param params.streamingEnabled
 * @param params.streamId
 * @returns The streaming result.
 */
export async function runStreamingCompletion(params: {
  /** The non-streaming call function (fallback). */
  // The opts now accept an optional `onToken` callback so the
  // streaming-accumulation wrapper can be passed through to the
  // underlying model client. The previous signature only accepted
  // `{ stream: boolean }`, so the wrappedCallback was assigned to
  // a local variable and then `void wrappedCallback;`'d — the
  // underlying call never saw it, `accumulatedContent` stayed empty,
  // and the entire streaming-accumulation path was dead.
  call: (opts: { stream: boolean; onToken?: StreamCallback }) => Promise<ModelResponse>;
  /** The stream callback (receives text deltas + null sentinel). */
  streamCallback?: StreamCallback;
  /** Whether streaming is enabled. */
  streamingEnabled: boolean;
  /** The stream ID (for dedup). */
  streamId?: string;
}): Promise<StreamingResult> {
  const { call, streamCallback, streamingEnabled } = params;
  const streamId = params.streamId ?? `stream-${randomUUID().slice(0, 12)}`;

  // If streaming is disabled or no callback, do a regular call
  if (!streamingEnabled || !streamCallback) {
    const response = await call({ stream: false });
    return {
      content: response.content,
      streamed: false,
      skipFinalSend: false,
      fallbackResponse: response,
      streamId,
    };
  }

  // Try streaming
  let accumulatedContent = '';

  try {
    // The wrapped callback both accumulates content (so we can
    // skip the final send if streaming already delivered the full
    // text) AND forwards deltas to the caller-supplied
    // `streamCallback`. We pass `wrappedCallback` to `call` via
    // the new `onToken` option so the underlying model client can
    // actually invoke it on each delta. The previous
    // implementation assigned `wrappedCallback` to a local
    // variable and then `void wrappedCallback;`'d it — the call
    // function never saw it, so `accumulatedContent` was always
    // `''` and the streaming-accumulation path was completely
    // broken.
    const wrappedCallback: StreamCallback = (delta) => {
      if (delta !== null) {
        accumulatedContent += delta;
      }
      streamCallback?.(delta);
    };

    const response = await call({ stream: true, onToken: wrappedCallback });

    // If the response has content (non-streaming fallback within the call)
    // longer than what we accumulated via streaming, prefer the response
    // content — the model client may have buffered and returned the full
    // text via `response.content` instead of streaming it.
    if (response.content && response.content.length > accumulatedContent.length) {
      accumulatedContent = response.content;
    }

    // Signal end of stream
    streamCallback?.(null);

    return {
      content: accumulatedContent,
      streamed: true,
      skipFinalSend: accumulatedContent.length > 0,
      streamId,
    };
  } catch (_err) {
    // Streaming failed — fall back to non-streaming
    const fallbackResponse = await call({ stream: false });

    return {
      content: fallbackResponse.content,
      streamed: false,
      skipFinalSend: false,
      fallbackResponse,
      streamId,
    };
  }
}

/**
 * Accumulate streamed chunks into a single string.
 *
 * @param chunks - The chunks to accumulate.
 * @returns The accumulated text.
 */
export function accumulateChunks(chunks: StreamChunk[]): string {
  return chunks
    .filter((c) => c.text !== null)
    .map((c) => c.text)
    .join('');
}

/**
 * Create a buffered consumer for a StreamingQueue.
 *
 * Buffers chunks and calls the consumer callback on a flush interval
 * (coalescing multiple chunks into a single update for UI efficiency).
 *
 * @param queue - The streaming queue.
 * @param consumer - The function to call with accumulated text.
 * @param bufferSize - Max chars before flushing (default: 1000).
 * @returns A cleanup function.
 */
export function createBufferedConsumer(
  queue: StreamingQueue,
  consumer: (text: string) => void,
  bufferSize: number = 1000,
): () => void {
  let buffer = '';

  const onFlush = (chunks: StreamChunk[]): void => {
    for (const chunk of chunks) {
      if (chunk.text !== null) {
        buffer += chunk.text;
      }
    }

    if (buffer.length >= bufferSize) {
      consumer(buffer);
      buffer = '';
    }
  };

  const onEnd = (): void => {
    if (buffer.length > 0) {
      consumer(buffer);
      buffer = '';
    }
  };

  queue.on('flush', onFlush);
  queue.on('end', onEnd);

  // Return cleanup function
  return () => {
    queue.off('flush', onFlush);
    queue.off('end', onEnd);
  };
}
