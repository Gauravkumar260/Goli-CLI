/**
 * Unit tests for the error classifier and credential pool.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { CredentialPool } from '../src/credential-pool.js';
import {
  classifyApiError,
  isTerminalAuthError,
  TERMINAL_AUTH_REASONS,
} from '../src/error-classifier.js';

describe('classifyApiError', () => {
  it('classifies 401 as auth', () => {
    const result = classifyApiError({ status: 401, message: 'Unauthorized' }, 'openai', 'gpt-4o');
    expect(result.reason).toBe('auth');
    expect(result.shouldRotateCredential).toBe(true);
    expect(result.shouldRetry).toBe(true);
    expect(result.isTerminal).toBe(false);
  });

  it('classifies terminal auth as auth_permanent', () => {
    const result = classifyApiError(
      new Error('token_revoked: key has been revoked'),
      'openai',
      'gpt-4o',
    );
    expect(result.reason).toBe('auth_permanent');
    expect(result.shouldRotateCredential).toBe(true);
    expect(result.isTerminal).toBe(true);
    expect(result.shouldRetry).toBe(false);
  });

  it('classifies 402 as billing', () => {
    const result = classifyApiError({ status: 402, message: 'billing' }, 'openai', 'gpt-4o');
    expect(result.reason).toBe('billing');
    expect(result.shouldRotateCredential).toBe(true);
    expect(result.shouldRetry).toBe(false);
  });

  it('classifies 429 as rate_limit', () => {
    const result = classifyApiError({ status: 429, message: 'Too many requests' });
    expect(result.reason).toBe('rate_limit');
    expect(result.shouldRetry).toBe(true);
    expect(result.shouldRotateCredential).toBe(false);
    expect(result.suggestedRetryDelayMs).toBe(5000);
  });

  it('classifies 529 as overloaded', () => {
    const result = classifyApiError({ status: 529, message: 'Overloaded' });
    expect(result.reason).toBe('overloaded');
    expect(result.shouldRetry).toBe(true);
    expect(result.suggestedRetryDelayMs).toBe(3000);
  });

  it('classifies 500-599 as server_error', () => {
    const result = classifyApiError({ status: 503, message: 'Service unavailable' });
    expect(result.reason).toBe('server_error');
    expect(result.shouldRetry).toBe(true);
  });

  it('classifies timeout errors', () => {
    const result = classifyApiError(new Error('Request timed out'));
    expect(result.reason).toBe('timeout');
    expect(result.shouldRetry).toBe(true);
  });

  it('classifies context overflow', () => {
    const result = classifyApiError(new Error('context length exceeded maximum'));
    expect(result.reason).toBe('context_overflow');
    expect(result.shouldCompress).toBe(true);
  });

  it('classifies 413 as payload_too_large', () => {
    const result = classifyApiError({ status: 413, message: 'payload too large' });
    expect(result.reason).toBe('payload_too_large');
    expect(result.shouldCompress).toBe(true);
  });

  it('classifies 404 as model_not_found', () => {
    const result = classifyApiError({ status: 404, message: 'model not found' });
    expect(result.reason).toBe('model_not_found');
    expect(result.shouldFallbackModel).toBe(true);
  });

  it('classifies content policy blocks', () => {
    const result = classifyApiError(new Error('content policy violation'));
    expect(result.reason).toBe('content_policy_blocked');
    expect(result.shouldRetry).toBe(false);
  });

  it('classifies provider policy blocks', () => {
    const result = classifyApiError(new Error('provider policy blocked'));
    expect(result.reason).toBe('provider_policy_blocked');
    expect(result.shouldFallbackModel).toBe(true);
  });

  it('classifies unknown errors as retryable', () => {
    const result = classifyApiError(new Error('something weird happened'));
    expect(result.reason).toBe('unknown');
    expect(result.shouldRetry).toBe(true);
  });

  it('preserves provider and model in result', () => {
    const result = classifyApiError(new Error('error'), 'deepseek', 'deepseek-v4');
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-v4');
  });
});

describe('isTerminalAuthError', () => {
  it('detects token_invalidated', () => {
    expect(isTerminalAuthError(new Error('token_invalidated'))).toBe(true);
  });

  it('detects token_revoked', () => {
    expect(isTerminalAuthError(new Error('token_revoked'))).toBe(true);
  });

  it('detects refresh_token_reused', () => {
    expect(isTerminalAuthError(new Error('refresh_token_reused'))).toBe(true);
  });

  it('does not flag non-terminal auth errors', () => {
    expect(isTerminalAuthError(new Error('Unauthorized'))).toBe(false);
    expect(isTerminalAuthError(new Error('rate limit'))).toBe(false);
  });
});

describe('TERMINAL_AUTH_REASONS', () => {
  it('contains the expected set', () => {
    expect(TERMINAL_AUTH_REASONS.has('token_invalidated')).toBe(true);
    expect(TERMINAL_AUTH_REASONS.has('token_revoked')).toBe(true);
    expect(TERMINAL_AUTH_REASONS.has('invalid_grant')).toBe(true);
    expect(TERMINAL_AUTH_REASONS.has('refresh_token_reused')).toBe(true);
  });
});

describe('CredentialPool', () => {
  let pool: CredentialPool;

  beforeEach(() => {
    pool = new CredentialPool();
  });

  it('starts empty', () => {
    expect(pool.count).toBe(0);
    expect(pool.availableCount).toBe(0);
  });

  it('adds credentials', () => {
    pool.add('key1', 'secret1');
    pool.add('key2', 'secret2');
    expect(pool.count).toBe(2);
    expect(pool.availableCount).toBe(2);
  });

  it('returns credentials round-robin', () => {
    pool.add('key1', 'secret1');
    pool.add('key2', 'secret2');
    const c1 = pool.getAvailable();
    const c2 = pool.getAvailable();
    expect(c1!.id).toBe('key1');
    expect(c2!.id).toBe('key2');
  });

  it('returns null when all dead', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', new Error('token_revoked'));
    expect(pool.getAvailable()).toBeNull();
    expect(pool.deadCount).toBe(1);
  });

  it('marks rate-limited as EXHAUSTED', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    const cred = pool.getAll()[0]!;
    expect(cred.state).toBe('EXHAUSTED');
  });

  it('marks billing as EXHAUSTED with longer cooldown', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 402, message: 'billing' });
    const cred = pool.getAll()[0]!;
    expect(cred.state).toBe('EXHAUSTED');
  });

  it('marks terminal auth as DEAD', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', new Error('token_invalidated'));
    const cred = pool.getAll()[0]!;
    expect(cred.state).toBe('DEAD');
    expect(pool.deadCount).toBe(1);
  });

  it('recovers EXHAUSTED after cooldown', () => {
    pool = new CredentialPool({ defaultCooldownMs: 10 });
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    expect(pool.availableCount).toBe(0);

    // Wait for cooldown
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const cred = pool.getAvailable();
        expect(cred).not.toBeNull();
        expect(cred!.state).toBe('OK');
        resolve();
      }, 20);
    });
  });

  it('rotates to next credential on EXHAUSTED', () => {
    pool.add('key1', 'secret1');
    pool.add('key2', 'secret2');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    const cred = pool.getAvailable();
    expect(cred!.id).toBe('key2');
  });

  it('shouldRotate returns true for EXHAUSTED', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    expect(pool.shouldRotate('key1')).toBe(true);
    expect(pool.shouldRotate('nonexistent')).toBe(false);
  });

  it('markSuccess does NOT revive EXHAUSTED credentials until cooldown elapses', () => {
    // Correct behavior: a successful call to a DIFFERENT credential doesn't
    // mean the provider's rate-limit window for this one has expired. We
    // honor the cooldown even on success. The previous implementation
    // flipped EXHAUSTED → OK immediately on success, which could re-trigger
    // 429 within the provider's rate-limit window.
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    pool.markSuccess('key1');
    const cred = pool.getAll()[0]!;
    expect(cred.state).toBe('EXHAUSTED');
  });

  it('markSuccess revives EXHAUSTED credentials after cooldown elapses', async () => {
    // Use a credential-pool with a tiny cooldown so the test doesn't sleep.
    const shortPool = new CredentialPool({ defaultCooldownMs: 1 });
    shortPool.add('key1', 'secret1');
    shortPool.markError('key1', { status: 429, message: 'rate limit' });
    // Wait for cooldown to elapse (5ms is plenty for defaultCooldownMs=1).
    await new Promise((resolve) => setTimeout(resolve, 5));
    shortPool.markSuccess('key1');
    const cred = shortPool.getAll()[0]!;
    expect(cred.state).toBe('OK');
  });

  it('markSuccess does not revive DEAD credentials', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', new Error('token_revoked'));
    pool.markSuccess('key1');
    const cred = pool.getAll()[0]!;
    expect(cred.state).toBe('DEAD');
  });

  it('getAll returns status for all credentials', () => {
    pool.add('key1', 'secret1');
    pool.add('key2', 'secret2');
    pool.markError('key1', new Error('token_revoked'));
    const all = pool.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.state).toBe('DEAD');
    expect(all[1]!.state).toBe('OK');
  });

  it('resetAll restores all to OK', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', { status: 429, message: 'rate limit' });
    pool.resetAll();
    expect(pool.availableCount).toBe(1);
    expect(pool.getAll()[0]!.errorCount).toBe(0);
  });

  it('tracks useCount', () => {
    pool.add('key1', 'secret1');
    pool.getAvailable();
    pool.getAvailable();
    expect(pool.getAll()[0]!.useCount).toBe(2);
  });

  it('tracks errorCount', () => {
    pool.add('key1', 'secret1');
    pool.markError('key1', new Error('some error'));
    pool.markError('key1', new Error('another error'));
    expect(pool.getAll()[0]!.errorCount).toBe(2);
  });
});
