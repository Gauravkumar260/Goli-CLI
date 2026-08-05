/**
 * Error-classified retry with jittered exponential backoff (Module 1).
 *
 * Not all errors should be retried:
 * - **Retryable**: 429 (rate limit), 5xx (server error), timeout, network error
 * - **Non-retryable**: 4xx (client error, except 429), malformed tool call, validation error
 *
 * ## Backoff strategy
 *
 * Exponential with jitter:
 *   delay = min(maxBackoff, initialBackoff × multiplier^attempt) × (1 - jitter × random())
 *
 * Jitter prevents thundering-herd retries against the same endpoint.
 *
 * ## Structured error classification (Hermes pattern, H3)
 *
 * This module now uses {@link classifyApiError} from `./error-classifier.js`
 * for richer retry decisions. The structured classifier returns:
 *   - `shouldRetry` — whether to retry at all
 *   - `shouldRotateCredential` — whether to rotate to a different API key
 *   - `shouldCompress` — whether the context is too large and needs compaction
 *
 * The `callWithRetry` function exposes these signals via the `onRetry`
 * callback so the caller (typically the agent loop) can act on them:
 *   - Rotate credentials via the {@link CredentialPool}
 *   - Trigger compaction before the next attempt
 *
 * @module agent/retry
 */

import { ModelHTTPError, ModelTimeoutError, ModelError, isGoliError } from '@goli-cli/shared/utils/errors.js';

import { classifyApiError } from './error-classifier.js';

import type { ClassifiedError } from './error-classifier.js';
import type { RetryConfig } from '@goli-cli/config';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for {@link callWithRetry}. */
export interface RetryOptions {
  /** Max retry attempts (default: from config, typically 3). */
  maxRetries?: number;
  /** Initial backoff in ms. */
  initialBackoffMs?: number;
  /** Backoff multiplier. */
  backoffMultiplier?: number;
  /** Max backoff cap in ms. */
  maxBackoffMs?: number;
  /** Jitter factor (0 = no jitter, 1 = full jitter). */
  jitterFactor?: number;
  /** Logger (optional). */
  logger?: Logger;
  /**
   * Called before each retry with the attempt number, delay, error, and
   * structured classification. The caller can use the classification to:
   *   - Rotate credentials (`classification.shouldRotateCredential`)
   *   - Trigger compaction (`classification.shouldCompress`)
   *   - Log the failover reason (`classification.reason`)
   */
  onRetry?: (
    attempt: number,
    delayMs: number,
    error: unknown,
    classification?: ClassifiedError,
  ) => void;
}

/**
 * Check if an error is retryable.
 *
 * Conservative policy: only network-class and explicit-Goli-retryable errors
 * are retried. Programming errors (TypeError, RangeError, SyntaxError) are
 * NOT retried — retrying a code bug just wastes budget and time.
 *
 * @param err
 */
export function isRetryableError(err: unknown): boolean {
  // GoliError: check the explicit classification.
  if (isGoliError(err)) {
    // Timeouts: retryable
    if (err instanceof ModelTimeoutError) return true;
    // HTTP errors: retry 429 and 5xx, don't retry other 4xx
    if (err instanceof ModelHTTPError) {
      return err.status === 429 || (err.status >= 500 && err.status < 600);
    }
    // Generic model errors (network failures): retryable
    if (err instanceof ModelError) return true;
    // Config errors, tool errors, sandbox errors: not retryable
    return false;
  }

  // Non-Goli errors: be conservative. Only retry errors that look like
  // network failures (so a flaky connection doesn't kill the run), not
  // programming errors (so a code bug surfaces immediately).
  if (err instanceof Error) {
    // Node network/system errors carry a `code` property starting with 'E'
    // (ECONNRESET, ECONNREFUSED, EPIPE, ETIMEDOUT, EAI_AGAIN, etc.).
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('E') && code.length > 1) {
      return true;
    }
    // Fetch network failures are TypeError ('fetch failed').
    if (err.name === 'TypeError' && /fetch|network/i.test(err.message)) {
      return true;
    }
    // AbortError from a timeout (when the caller didn't wrap it in ModelTimeoutError)
    if (err.name === 'AbortError') return true;
  }
  // Everything else (TypeError from a code bug, RangeError, SyntaxError,
  // ReferenceError, etc.) is NOT retried.
  return false;
}

/**
 * Call a function with retry on retryable errors.
 *
 * @param fn - The async function to call.
 * @param opts - Retry options.
 * @param config
 * @returns The result of `fn`.
 * @throws The last error if all retries are exhausted or error is non-retryable.
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
  config?: RetryConfig,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? config?.maxRetries ?? 3;
  const initialBackoff = opts.initialBackoffMs ?? config?.initialBackoffMs ?? 1000;
  const multiplier = opts.backoffMultiplier ?? config?.backoffMultiplier ?? 2;
  const maxBackoff = opts.maxBackoffMs ?? config?.maxBackoffMs ?? 30_000;
  const jitter = opts.jitterFactor ?? config?.jitterFactor ?? 0.5;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Classify the error using the structured classifier (H3).
      // This gives us shouldRetry, shouldRotateCredential, shouldCompress,
      // and the FailoverReason — richer than the simple isRetryableError.
      const classification = classifyApiError(err);

      // Non-retryable: rethrow immediately.
      // We check both isRetryableError (the conservative heuristic) AND
      // classification.shouldRetry (the structured classifier) — if EITHER
      // says "don't retry", we don't retry.
      if (!isRetryableError(err) || !classification.shouldRetry) {
        opts.logger?.debug('Error not retryable', {
          reason: classification.reason,
          shouldRotate: classification.shouldRotateCredential,
          shouldCompress: classification.shouldCompress,
        });
        throw err;
      }

      // Exhausted retries: throw
      if (attempt >= maxRetries) {
        opts.logger?.error('Retries exhausted', {
          attempts: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
          reason: classification.reason,
        });
        throw err;
      }

      // Compute backoff with full jitter (AWS recommended pattern).
      const baseDelay = Math.min(maxBackoff, initialBackoff * Math.pow(multiplier, attempt));
      const jitterFloor = baseDelay * (1 - jitter);
      const delay = Math.floor(jitterFloor + Math.random() * (baseDelay - jitterFloor));

      // Guard against NaN/Infinity/negative from malformed config (e.g.
      // jitterFactor > 1, initialBackoffMs = 0 with multiplier = 0).
      // Fallback of 1s is a safe middle ground: long enough to let a transient
      // failure clear, short enough not to stall the agent loop noticeably.
      // Mirrors the default initialBackoffMs (line 129 above).
      const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 1000;

      opts.logger?.warn('Retrying after error', {
        attempt: attempt + 1,
        maxRetries,
        delayMs: safeDelay,
        error: err instanceof Error ? err.message : String(err),
        reason: classification.reason,
        shouldRotate: classification.shouldRotateCredential,
        shouldCompress: classification.shouldCompress,
      });

      // Pass the classification to the caller so it can rotate credentials
      // or trigger compaction before the next attempt.
      opts.onRetry?.(attempt + 1, safeDelay, err, classification);

      await sleep(safeDelay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Promise-based sleep that honors an optional abort signal.
 *
 * The previous implementation used a plain `setTimeout(resolve, ms)`
 * sleep that waited the full delay even if the agent was aborted
 * during the wait. The next iteration's abort check would catch
 * it, but the user perceived a hung agent for up to `maxBackoffMs`
 * (30s default). We now reject early if the signal aborts.
 * @param ms
 * @param signal Optional AbortSignal — sleep rejects early with an AbortError if aborted.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
