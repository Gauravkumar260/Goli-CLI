/**
 * Structured error classifier (Hermes pattern).
 *
 * Classifies API errors into structured categories with recovery hints.
 * The retry loop consults the classifier instead of inline string
 * matching — clean separation of "what happened" from "what to do".
 *
 * ## FailoverReason categories (20+)
 *
 * auth, auth_permanent, billing, rate_limit, overloaded, server_error,
 * timeout, context_overflow, payload_too_large, image_too_large,
 * model_not_found, provider_policy_blocked, content_policy_blocked,
 * format_error, invalid_encrypted_content, multimodal_tool_content_unsupported,
 * thinking_signature, long_context_tier, oauth_long_context_beta_forbidden,
 * llama_cpp_grammar_pattern, unknown
 *
 * @module agent/error-classifier
 */

/** Structured error reason categories. */
export type FailoverReason =
  | 'auth'
  | 'auth_permanent'
  | 'billing'
  | 'rate_limit'
  | 'overloaded'
  | 'server_error'
  | 'timeout'
  | 'context_overflow'
  | 'payload_too_large'
  | 'image_too_large'
  | 'model_not_found'
  | 'provider_policy_blocked'
  | 'content_policy_blocked'
  | 'format_error'
  | 'invalid_encrypted_content'
  | 'multimodal_tool_content_unsupported'
  | 'thinking_signature'
  | 'long_context_tier'
  | 'oauth_long_context_beta_forbidden'
  | 'llama_cpp_grammar_pattern'
  | 'unknown';

/** A classified error with recovery hints. */
export interface ClassifiedError {
  /** The structured reason. */
  reason: FailoverReason;
  /** The HTTP status code (if applicable). */
  statusCode?: number;
  /** The provider that raised the error. */
  provider?: string;
  /** The model that was being used. */
  model?: string;
  /** The error message. */
  message: string;
  /** Additional context. */
  errorContext?: Record<string, unknown>;

  // ─── Recovery hints ───────────────────────────────────────────
  /** Whether this error is retryable (transient). */
  shouldRetry: boolean;
  /** Whether to rotate to a different credential. */
  shouldRotateCredential: boolean;
  /** Whether to compress context and retry. */
  shouldCompress: boolean;
  /** Whether to fall back to a different model. */
  shouldFallbackModel: boolean;
  /** Whether this is a terminal error (no recovery). */
  isTerminal: boolean;
  /** Suggested retry delay in ms (0 = immediate). */
  suggestedRetryDelayMs: number;
}

/** Options for the ErrorClassifier. */
export interface ErrorClassifierOptions {
  /** Logger instance. */
  logger?: import('../utils/logger.js').Logger;
}

/**
 * Classify an API error into a structured reason with recovery hints.
 *
 * @param error - The error (can be an Error, a response object, or a string).
 * @param provider - The provider name.
 * @param model - The model name.
 * @returns The classified error.
 */
export function classifyApiError(
  error: unknown,
  provider?: string,
  model?: string,
): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = extractStatusCode(error);
  const lowerMessage = message.toLowerCase();

  // ─── Auth errors ─────────────────────────────────────────────
  if (statusCode === 401 || lowerMessage.includes('unauthorized') || lowerMessage.includes('invalid api key') || lowerMessage.includes('api key')) {
    // Check for permanent auth failure
    const permanentReasons = [
      'token_invalidated', 'token_revoked', 'invalid_token', 'invalid_grant',
      'unauthorized_client', 'refresh_token_reused', 'key has been revoked',
    ];
    const isPermanent = permanentReasons.some((r) => lowerMessage.includes(r));
    return makeClassified(
      isPermanent ? 'auth_permanent' : 'auth',
      statusCode, provider, model, message,
      {
        shouldRetry: !isPermanent,
        shouldRotateCredential: true,
        isTerminal: isPermanent,
        suggestedRetryDelayMs: 1000,
      },
    );
  }

  // ─── Terminal auth (even without 401) ───────────────────────
  if (isTerminalAuthError(error)) {
    return makeClassified(
      'auth_permanent', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: true,
        isTerminal: true,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Billing errors ──────────────────────────────────────────
  if (statusCode === 402 || lowerMessage.includes('billing') || lowerMessage.includes('payment') || lowerMessage.includes('quota') || lowerMessage.includes('insufficient')) {
    return makeClassified(
      'billing', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: true,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Rate limit ──────────────────────────────────────────────
  if (statusCode === 429 || lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
    return makeClassified(
      'rate_limit', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 5000,
      },
    );
  }

  // ─── Overloaded ──────────────────────────────────────────────
  if (statusCode === 529 || lowerMessage.includes('overloaded') || lowerMessage.includes('capacity')) {
    return makeClassified(
      'overloaded', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 3000,
      },
    );
  }

  // ─── Server errors ───────────────────────────────────────────
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return makeClassified(
      'server_error', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 2000,
      },
    );
  }

  // ─── Timeout ─────────────────────────────────────────────────
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out') || lowerMessage.includes('etimedout') || lowerMessage.includes('econnreset')) {
    return makeClassified(
      'timeout', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 3000,
      },
    );
  }

  // ─── Context overflow ────────────────────────────────────────
  if (lowerMessage.includes('context length') || lowerMessage.includes('context overflow') || lowerMessage.includes('maximum context') || lowerMessage.includes('too long') || (statusCode === 400 && lowerMessage.includes('token'))) {
    return makeClassified(
      'context_overflow', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        shouldCompress: true,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Payload too large ───────────────────────────────────────
  if (statusCode === 413 || lowerMessage.includes('payload too large') || lowerMessage.includes('request entity too large')) {
    return makeClassified(
      'payload_too_large', statusCode, provider, model, message,
      {
        shouldRetry: true,
        shouldRotateCredential: false,
        shouldCompress: true,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Image too large ─────────────────────────────────────────
  if (lowerMessage.includes('image') && (lowerMessage.includes('too large') || lowerMessage.includes('size'))) {
    return makeClassified(
      'image_too_large', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Model not found ─────────────────────────────────────────
  if (statusCode === 404 || lowerMessage.includes('model not found') || lowerMessage.includes('does not exist') || lowerMessage.includes('not available')) {
    return makeClassified(
      'model_not_found', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: false,
        shouldFallbackModel: true,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Content policy blocked ──────────────────────────────────
  if (lowerMessage.includes('content') && (lowerMessage.includes('policy') || lowerMessage.includes('filter') || lowerMessage.includes('safety'))) {
    return makeClassified(
      'content_policy_blocked', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Provider policy blocked ─────────────────────────────────
  if (lowerMessage.includes('policy') && (lowerMessage.includes('block') || lowerMessage.includes('violat'))) {
    return makeClassified(
      'provider_policy_blocked', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: false,
        shouldFallbackModel: true,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  if (lowerMessage.includes('format') || lowerMessage.includes('invalid request') || (statusCode === 400 && !lowerMessage.includes('token'))) {
    return makeClassified(
      'format_error', statusCode, provider, model, message,
      {
        shouldRetry: false,
        shouldRotateCredential: false,
        isTerminal: false,
        suggestedRetryDelayMs: 0,
      },
    );
  }

  // ─── Unknown ─────────────────────────────────────────────────
  return makeClassified(
    'unknown', statusCode, provider, model, message,
    {
      shouldRetry: true, // Optimistic: retry unknown errors
      shouldRotateCredential: false,
      isTerminal: false,
      suggestedRetryDelayMs: 2000,
    },
  );
}

/**
 * Helper to create a ClassifiedError with defaults.
 * @param reason
 * @param statusCode
 * @param provider
 * @param model
 * @param message
 * @param hints
 * @param hints.shouldRetry
 * @param hints.shouldRotateCredential
 * @param hints.shouldCompress
 * @param hints.shouldFallbackModel
 * @param hints.isTerminal
 * @param hints.suggestedRetryDelayMs
 */
function makeClassified(
  reason: FailoverReason,
  statusCode: number | undefined,
  provider: string | undefined,
  model: string | undefined,
  message: string,
  hints: {
    shouldRetry: boolean;
    shouldRotateCredential: boolean;
    shouldCompress?: boolean;
    shouldFallbackModel?: boolean;
    isTerminal: boolean;
    suggestedRetryDelayMs: number;
  },
): ClassifiedError {
  return {
    reason,
    statusCode,
    provider,
    model,
    message,
    shouldRetry: hints.shouldRetry,
    shouldRotateCredential: hints.shouldRotateCredential,
    shouldCompress: hints.shouldCompress ?? false,
    shouldFallbackModel: hints.shouldFallbackModel ?? false,
    isTerminal: hints.isTerminal,
    suggestedRetryDelayMs: hints.suggestedRetryDelayMs,
  };
}

/**
 * Extract HTTP status code from various error shapes.
 * @param error
 */
function extractStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e['status'] === 'number') return e['status'];
    if (typeof e['statusCode'] === 'number') return e['statusCode'];
    if (typeof e['code'] === 'string') {
      const match = e['code'].match(/(\d{3})/);
      if (match?.[1]) return parseInt(match[1], 10);
    }
  }
  return undefined;
}

/** Terminal auth reasons — DEAD credentials never auto-recover. */
export const TERMINAL_AUTH_REASONS: ReadonlySet<string> = new Set([
  'token_invalidated',
  'token_revoked',
  'invalid_token',
  'invalid_grant',
  'unauthorized_client',
  'refresh_token_reused',
  'key has been revoked',
]);

/**
 * Check if an auth error is terminal (credential is DEAD).
 * @param error
 */
export function isTerminalAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [...TERMINAL_AUTH_REASONS].some((r) => message.includes(r));
}
