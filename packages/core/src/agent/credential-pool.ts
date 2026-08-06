/**
 * Credential pool with OK/EXHAUSTED/DEAD states (Hermes pattern).
 *
 * Manages multiple API credentials for failover. On 429: retry once
 * with the same credential, then rotate. On 402: rotate immediately.
 * On terminal auth errors: mark as DEAD (never auto-recover).
 *
 * ## States
 *
 * - OK: credential is healthy and can be used
 * - EXHAUSTED: rate-limited or billing-limited; will recover after cooldown
 * - DEAD: terminal auth failure; never auto-recovers
 *
 * @module agent/credential-pool
 */

import { isTerminalAuthError } from './error-classifier.js';

import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Credential states. */
export type CredentialState = 'OK' | 'EXHAUSTED' | 'DEAD';

/** A single API credential. */
export interface Credential {
  /** Unique credential ID. */
  id: string;
  /** The API key. */
  apiKey: string;
  /** The base URL (optional override). */
  baseUrl?: string;
  /** Current state. */
  state: CredentialState;
  /** When the credential was marked EXHAUSTED (epoch ms). */
  exhaustedAt?: number;
  /** Cooldown period in ms (default: 60_000). */
  cooldownMs: number;
  /** Number of times this credential has been used. */
  useCount: number;
  /** Number of errors this credential has encountered. */
  errorCount: number;
}

/** Options for the CredentialPool. */
export interface CredentialPoolOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Default cooldown in ms (default: 60_000 = 1 min). */
  defaultCooldownMs?: number;
}

/**
 * Credential pool — manages multi-credential failover.
 *
 * @module agent/credential-pool
 */
export class CredentialPool {
  private readonly log?: Logger;
  private readonly defaultCooldownMs: number;
  private readonly credentials: Credential[] = [];
  private currentIndex = 0;

  constructor(opts: CredentialPoolOptions = {}) {
    this.log = opts.logger;
    this.defaultCooldownMs = opts.defaultCooldownMs ?? 60_000;
  }

  /**
   * Add a credential to the pool.
   *
   * @param id
   * @param apiKey
   * @param baseUrl
   * @throws Error if a credential with the same `id` already exists.
   */
  add(id: string, apiKey: string, baseUrl?: string): void {
    if (this.credentials.some((c) => c.id === id)) {
      throw new Error(`Credential with id "${id}" already exists in the pool`);
    }
    this.credentials.push({
      id,
      apiKey,
      baseUrl,
      state: 'OK',
      cooldownMs: this.defaultCooldownMs,
      useCount: 0,
      errorCount: 0,
    });
    this.log?.debug('Credential added', { id, count: this.credentials.length });
  }

  /**
   * Get the next available (OK) credential.
   *
   * Rotates through credentials round-robin. Skips EXHAUSTED (if still
   * in cooldown) and DEAD credentials.
   *
   * @returns The next available credential, or null if all are exhausted/dead.
   */
  getAvailable(): Credential | null {
    // Recover EXHAUSTED credentials whose cooldown has expired
    const now = Date.now();
    for (const cred of this.credentials) {
      if (cred.state === 'EXHAUSTED' && cred.exhaustedAt) {
        if (now - cred.exhaustedAt >= cred.cooldownMs) {
          cred.state = 'OK';
          cred.exhaustedAt = undefined;
          this.log?.info('Credential recovered from EXHAUSTED', { id: cred.id });
        }
      }
    }

    // Find next OK credential (round-robin)
    for (let i = 0; i < this.credentials.length; i++) {
      const idx = (this.currentIndex + i) % this.credentials.length;
      const cred = this.credentials[idx]!;
      if (cred.state === 'OK') {
        this.currentIndex = (idx + 1) % this.credentials.length;
        cred.useCount++;
        return cred;
      }
    }

    // No OK credentials — round-robin through EXHAUSTED ones too,
    // so we don't keep hammering the same rate-limited key. Prefer the
    // one with the soonest expected recovery (oldest `exhaustedAt`).
    const exhausted = this.credentials
      .filter((c) => c.state === 'EXHAUSTED')
      .sort((a, b) => (a.exhaustedAt ?? 0) - (b.exhaustedAt ?? 0));
    if (exhausted.length > 0) {
      const next = exhausted[0]!;
      this.log?.warn('No OK credentials — returning EXHAUSTED (may still fail)', { id: next.id });
      return next;
    }

    this.log?.error('No available credentials (all DEAD)');
    return null;
  }

  /**
   * Mark a credential as having encountered an error.
   *
   * - Terminal auth error → DEAD (never recovers)
   * - 429 rate limit → EXHAUSTED (recovers after cooldown)
   * - 402 billing → EXHAUSTED (recovers after longer cooldown)
   * - Other errors → increment errorCount (no state change)
   *
   * @param credentialId - The credential ID.
   * @param error - The error encountered.
   */
  markError(credentialId: string, error: unknown): void {
    const cred = this.credentials.find((c) => c.id === credentialId);
    if (!cred) return;

    cred.errorCount++;

    // Check for terminal auth failure
    if (isTerminalAuthError(error)) {
      cred.state = 'DEAD';
      this.log?.error('Credential marked DEAD (terminal auth)', {
        id: cred.id,
        errorCount: cred.errorCount,
      });
      return;
    }

    // Check for rate limit (429)
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const statusCode = extractStatus(error);

    if (statusCode === 429 || message.includes('rate limit')) {
      cred.state = 'EXHAUSTED';
      cred.exhaustedAt = Date.now();
      this.log?.warn('Credential marked EXHAUSTED (rate limited)', {
        id: cred.id,
        cooldownMs: cred.cooldownMs,
      });
      return;
    }

    // Check for billing (402). Be specific — generic 'billing address' or
    // 'quota header' messages shouldn't trigger a 5x cooldown.
    if (
      statusCode === 402 ||
      /insufficient.*(balance|credit|quota|funds)/i.test(message) ||
      /payment.*(required|failed|declined)/i.test(message)
    ) {
      cred.state = 'EXHAUSTED';
      cred.exhaustedAt = Date.now();
      cred.cooldownMs = this.defaultCooldownMs * 5; // 5x cooldown for billing
      this.log?.warn('Credential marked EXHAUSTED (billing)', {
        id: cred.id,
        cooldownMs: cred.cooldownMs,
      });
      return;
    }

    this.log?.debug('Credential error (no state change)', {
      id: cred.id,
      errorCount: cred.errorCount,
      message: message.slice(0, 100),
    });
  }

  /**
   * Mark a credential as having succeeded.
   *
   * Resets errorCount. State transitions EXHAUSTED → OK ONLY if the
   * cooldown has elapsed; otherwise we honor the rate-limit window even
   * on success (a successful call to a *different* credential doesn't
   * mean the provider's rate-limit window for this one has expired).
   * @param credentialId
   */
  markSuccess(credentialId: string): void {
    const cred = this.credentials.find((c) => c.id === credentialId);
    if (!cred) return;
    if (cred.state === 'EXHAUSTED' && cred.exhaustedAt) {
      const now = Date.now();
      if (now - cred.exhaustedAt >= cred.cooldownMs) {
        cred.state = 'OK';
        cred.exhaustedAt = undefined;
        this.log?.info('Credential recovered from EXHAUSTED (post-cooldown success)', { id: cred.id });
      }
      // else: stay EXHAUSTED — the rate-limit window is still open.
    }
    // Don't reset errorCount — it's cumulative for observability
  }

  /**
   * Check if a credential should be rotated (on second 429).
   *
   * Hermes pattern: on 429, first occurrence retries same credential,
   * second occurrence rotates to next.
   *
   * @param credentialId - The credential ID.
   * @returns True if should rotate.
   */
  shouldRotate(credentialId: string): boolean {
    const cred = this.credentials.find((c) => c.id === credentialId);
    if (!cred) return false;
    // If already EXHAUSTED and called again → rotate
    return cred.state === 'EXHAUSTED';
  }

  /** Get the total credential count. */
  get count(): number {
    return this.credentials.length;
  }

  /** Get the count of OK credentials. */
  get availableCount(): number {
    return this.credentials.filter((c) => c.state === 'OK').length;
  }

  /** Get the count of DEAD credentials. */
  get deadCount(): number {
    return this.credentials.filter((c) => c.state === 'DEAD').length;
  }

  /** Get all credentials (for debugging / status display). */
  getAll(): Array<{ id: string; state: CredentialState; useCount: number; errorCount: number }> {
    return this.credentials.map((c) => ({
      id: c.id,
      state: c.state,
      useCount: c.useCount,
      errorCount: c.errorCount,
    }));
  }

  /** Reset all credentials to OK (for testing). Also resets cooldownMs. */
  resetAll(): void {
    for (const cred of this.credentials) {
      cred.state = 'OK';
      cred.exhaustedAt = undefined;
      cred.errorCount = 0;
      // Reset cooldownMs too — a 5x cooldown from a prior 402 should not
      // carry over to the next test/run.
      cred.cooldownMs = this.defaultCooldownMs;
    }
    this.currentIndex = 0;
  }
}

/**
 * Extract HTTP status code from error.
 *
 * The previous implementation only checked `error.status` and
 * `error.statusCode`. Many HTTP libraries (axios, fetch wrappers)
 * nest the status under `error.response.status` or
 * `error.cause.status`. Errors from these libraries would not be
 * classified as 429/402, causing the credential pool to treat
 * rate-limit errors as generic failures (no state transition to
 * EXHAUSTED, no cooldown). We now also check `response.status`,
 * `cause.status`, and `cause.statusCode`.
 * @param error
 */
function extractStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e['status'] === 'number') return e['status'];
    if (typeof e['statusCode'] === 'number') return e['statusCode'];
    // Axios-style: error.response.status.
    const response = e['response'];
    if (typeof response === 'object' && response !== null) {
      const r = response as Record<string, unknown>;
      if (typeof r['status'] === 'number') return r['status'];
      if (typeof r['statusCode'] === 'number') return r['statusCode'];
    }
    // Error-cause-style: error.cause.status (used by Node's
    // `new Error('msg', { cause: originalError })` and fetch).
    const cause = e['cause'];
    if (typeof cause === 'object' && cause !== null) {
      const c = cause as Record<string, unknown>;
      if (typeof c['status'] === 'number') return c['status'];
      if (typeof c['statusCode'] === 'number') return c['statusCode'];
    }
  }
  return undefined;
}
