/**
 * Unit tests for the retry / backoff layer.
 */

import { describe, it, expect } from 'vitest';

import { callWithRetry, isRetryableError } from '../../packages/core/src/agent/retry.js';
import {
  ModelTimeoutError,
  ModelHTTPError,
  ModelError,
  ConfigValidationError,
  ToolValidationError,
} from '../../packages/shared/src/utils/errors.js';

describe('isRetryableError', () => {
  it('retries timeouts', () => {
    expect(isRetryableError(new ModelTimeoutError('timed out'))).toBe(true);
  });

  it('retries 429 (rate limit)', () => {
    expect(isRetryableError(new ModelHTTPError('rate limited', 429))).toBe(true);
  });

  it('retries 500-599 (server errors)', () => {
    expect(isRetryableError(new ModelHTTPError('server error', 500))).toBe(true);
    expect(isRetryableError(new ModelHTTPError('bad gateway', 502))).toBe(true);
    expect(isRetryableError(new ModelHTTPError('server error', 599))).toBe(true);
  });

  it('does NOT retry 4xx (except 429)', () => {
    expect(isRetryableError(new ModelHTTPError('bad request', 400))).toBe(false);
    expect(isRetryableError(new ModelHTTPError('unauthorized', 401))).toBe(false);
    expect(isRetryableError(new ModelHTTPError('forbidden', 403))).toBe(false);
    expect(isRetryableError(new ModelHTTPError('not found', 404))).toBe(false);
  });

  it('retries generic model errors (network)', () => {
    expect(isRetryableError(new ModelError('ECONNRESET'))).toBe(true);
  });

  it('does NOT retry config errors', () => {
    expect(isRetryableError(new ConfigValidationError('bad config'))).toBe(false);
  });

  it('does NOT retry tool validation errors', () => {
    expect(isRetryableError(new ToolValidationError('bad args', 'grep'))).toBe(false);
  });

  it('does NOT retry unknown programming errors (TypeError, RangeError, etc.)', () => {
    // Conservative policy: only retry network-class errors. Retrying a
    // code bug (TypeError, RangeError, SyntaxError) just wastes budget
    // and time — the bug will reproduce on every retry.
    expect(isRetryableError(new TypeError('cannot read property of undefined'))).toBe(false);
    expect(isRetryableError(new RangeError('invalid array length'))).toBe(false);
    expect(isRetryableError(new SyntaxError('unexpected token'))).toBe(false);
    expect(isRetryableError(new Error('something weird'))).toBe(false);
  });

  it('retries network-class errors (ECONNRESET, fetch failed, AbortError)', () => {
    const connReset = new Error('socket hang up');
    (connReset as { code?: string }).code = 'ECONNRESET';
    expect(isRetryableError(connReset)).toBe(true);

    const fetchFailed = new TypeError('fetch failed');
    expect(isRetryableError(fetchFailed)).toBe(true);

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryableError(abort)).toBe(true);
  });
});

describe('callWithRetry', () => {
  it('returns the result on first success', async () => {
    let calls = 0;
    const result = await callWithRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on retryable error and succeeds', async () => {
    let calls = 0;
    const result = await callWithRetry(
      async () => {
        calls++;
        if (calls < 2) throw new ModelHTTPError('rate limited', 429);
        return 'ok';
      },
      { initialBackoffMs: 1, maxRetries: 3 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('throws immediately on non-retryable error', async () => {
    let calls = 0;
    await expect(
      callWithRetry(
        async () => {
          calls++;
          throw new ConfigValidationError('bad config');
        },
        { initialBackoffMs: 1 },
      ),
    ).rejects.toThrow('bad config');
    expect(calls).toBe(1); // no retries
  });

  it('exhausts retries and throws', async () => {
    let calls = 0;
    await expect(
      callWithRetry(
        async () => {
          calls++;
          throw new ModelTimeoutError('always times out');
        },
        { maxRetries: 2, initialBackoffMs: 1, jitterFactor: 0 },
      ),
    ).rejects.toThrow('always times out');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('calls onRetry before each retry', async () => {
    const retries: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await callWithRetry(
      async () => {
        calls++;
        if (calls < 3) throw new ModelHTTPError('rate limited', 429);
        return 'ok';
      },
      {
        maxRetries: 3,
        initialBackoffMs: 10,
        jitterFactor: 0,
        onRetry: (attempt, delayMs) => retries.push({ attempt, delayMs }),
      },
    );
    expect(retries).toHaveLength(2);
    expect(retries[0]!.attempt).toBe(1);
    expect(retries[1]!.attempt).toBe(2);
  });
});
