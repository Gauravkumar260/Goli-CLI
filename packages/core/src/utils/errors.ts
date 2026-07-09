/**
 * Typed error hierarchy for GOLI-CLI.
 *
 * Every domain-specific failure mode extends {@link GoliError}. This gives
 * us:
 *
 * - A single base class to catch in the top-level CLI handler.
 * - A `code` field for programmatic discrimination (no string matching).
 * - A `cause` chain for wrapping lower-level errors without losing context.
 * - Consistent JSON serialization for the audit log (Module 4) and OTel
 *   tracing (Module 6).
 *
 * ## Conventions
 *
 * - Throw a *specific* subclass (`ConfigError`, not `GoliError`).
 * - Set `cause` when wrapping; preserve the original stack where possible.
 * - Use `code` for stable, machine-readable identifiers (e.g. `'GLM_TIMEOUT'`).
 *   Never reuse a code across two distinct failure modes.
 *
 * @module utils/errors
 */

/**
 * Abstract base class for every GOLI-CLI domain error.
 *
 * Subclass this — never throw a bare `GoliError` directly.
 */
export abstract class GoliError extends Error {
  /** Stable, machine-readable identifier (e.g. `'GLM_TIMEOUT'`). */
  abstract readonly code: string;
  /** Human-readable category (e.g. `'config'`, `'network'`, `'sandbox'`). */
  abstract readonly category: ErrorCategory;

  constructor(message: string, options?: { cause?: unknown; context?: Record<string, unknown> }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    // Maintain proper prototype chain across TS transpilation targets
    Object.setPrototypeOf(this, new.target.prototype);
    // Capture context for structured logging (Module 6 OTel)
    if (options?.context) {
      (this as unknown as { context: Record<string, unknown> }).context = options.context;
    }
  }

  /**
   * Convert to a plain object suitable for JSON logging / OTel attributes.
   * Avoids serializing the full Error stack. Includes any extra enumerable
   * own properties (e.g. `status` on {@link ModelHTTPError}) so subclasses
   * don't need to override this.
   */
  toJSON(): Record<string, unknown> {
    const own: Record<string, unknown> = {};
    // Collect subclass-specific fields (status, toolName, mode, etc.)
    for (const key of Object.getOwnPropertyNames(this)) {
      if (key === 'message' || key === 'stack' || key === 'cause') continue;
      const value = (this as unknown as Record<string, unknown>)[key];
      if (typeof value !== 'function') {
        own[key] = value;
      }
    }
    return {
      ...own,
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      cause:
        this.cause instanceof Error
          ? {
              name: this.cause.name,
              message: this.cause.message,
            }
          : this.cause,
    };
  }
}

/** Error categories used for routing in logging / alerting (Module 6). */
export type ErrorCategory =
  | 'config'
  | 'network'
  | 'sandbox'
  | 'tool'
  | 'model'
  | 'context'
  | 'memory'
  | 'eval'
  | 'orchestration'
  | 'auth'
  | 'unknown';

// ─── Config errors ────────────────────────────────────────────────────

/** Base class for all config-related errors. */
export abstract class ConfigError extends GoliError {
  readonly category = 'config' as const;
}

/** Thrown when a TOML config file is missing or unreadable. */
export class ConfigNotFoundError extends ConfigError {
  readonly code = 'CONFIG_NOT_FOUND';
}

/** Thrown when a config value fails schema validation (zod). */
export class ConfigValidationError extends ConfigError {
  readonly code = 'CONFIG_VALIDATION';
}

// ─── Model errors ─────────────────────────────────────────────────────

/** Thrown when a model endpoint is unreachable or returns a generic error. */
export class ModelError extends GoliError {
  readonly code = 'MODEL_ERROR';
  readonly category = 'model' as const;
}

/** Thrown when a model call times out. */
export class ModelTimeoutError extends GoliError {
  readonly code = 'MODEL_TIMEOUT';
  readonly category = 'model' as const;
}

/** Thrown when a model endpoint returns a non-2xx status. */
export class ModelHTTPError extends GoliError {
  readonly code = 'MODEL_HTTP';
  readonly category = 'model' as const;
  readonly status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

// ─── Tool errors (Module 3) ───────────────────────────────────────────

/** Thrown when a tool's input fails JSON Schema validation. */
export class ToolValidationError extends GoliError {
  readonly code = 'TOOL_VALIDATION';
  readonly category = 'tool' as const;
  readonly toolName: string;

  constructor(message: string, toolName: string, options?: { cause?: unknown }) {
    super(message, options);
    this.toolName = toolName;
  }
}

/** Thrown when a tool handler aborts (e.g. user denied permission). */
export class ToolExecutionError extends GoliError {
  readonly code = 'TOOL_EXECUTION';
  readonly category = 'tool' as const;
  readonly toolName: string;

  constructor(message: string, toolName: string, options?: { cause?: unknown }) {
    super(message, options);
    this.toolName = toolName;
  }
}

// ─── Sandbox errors (Module 4) ────────────────────────────────────────

/** Thrown when the OS-native sandbox refuses to execute a command. */
export class SandboxError extends GoliError {
  readonly code = 'SANDBOX_ERROR';
  readonly category = 'sandbox' as const;
}

/** Thrown when a command was denied by the approval policy. */
export class SandboxDeniedError extends GoliError {
  readonly code = 'SANDBOX_DENIED';
  readonly category = 'sandbox' as const;
  readonly mode: string;

  constructor(message: string, mode: string, options?: { cause?: unknown }) {
    super(message, options);
    this.mode = mode;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────

/**
 * Type guard: is the given value a {@link GoliError}?
 * @param value
 */
export function isGoliError(value: unknown): value is GoliError {
  return value instanceof GoliError;
}

/**
 * Wrap an unknown thrown value into a {@link GoliError}. If the value is
 * already a `GoliError`, return as-is. If it's a plain `Error`, wrap it
 * in a generic `GoliError` subclass. Otherwise stringify.
 *
 * Used by the top-level CLI error handler and the agent-loop retry layer
 * (Module 1).
 * @param value
 */
export function wrapUnknown(value: unknown): GoliError {
  if (isGoliError(value)) return value;
  if (value instanceof Error) {
    return new (class extends GoliError {
      readonly code = 'UNKNOWN';
      readonly category = 'unknown' as const;
    })(value.message, { cause: value });
  }
  return new (class extends GoliError {
    readonly code = 'UNKNOWN';
    readonly category = 'unknown' as const;
  })(String(value));
}
